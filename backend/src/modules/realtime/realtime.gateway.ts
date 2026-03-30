import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger } from '@nestjs/common';
import { RealtimeEmitterService } from './realtime-emitter.service';
import { RealtimePresenceService } from './realtime-presence.service';
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from './presence.types';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private presenceCheckInterval: ReturnType<typeof setInterval> | null = null;

  @WebSocketServer()
  server: Server;

  /** Injetado via setter em app.module para evitar dependência circular */
  private assignmentSvc: any = null;
  setAssignmentService(svc: any) { this.assignmentSvc = svc; }

  /** Injetado via setter em app.module para evitar dependência circular */
  private attendanceSvc: any = null;
  setAttendanceService(svc: any) { this.attendanceSvc = svc; }

  /** Injetado via setter em app.module para evitar dependência circular */
  private baileysSvc: any = null;
  setBaileysService(svc: any) { this.baileysSvc = svc; }

  /** Clock-outs pendentes: "tenantId:userId" → timer (grace period 60s) */
  private readonly pendingClockOuts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly emitter: RealtimeEmitterService,
    private readonly presence: RealtimePresenceService,
  ) {}

  private clearPendingClockOut(tenantId: string, userId: string) {
    const key = `${tenantId}:${userId}`;
    const pending = this.pendingClockOuts.get(key);
    if (pending) {
      clearTimeout(pending);
      this.pendingClockOuts.delete(key);
    }
  }

  private async emitPresenceToTenant(tenantId: string) {
    const { onlineIds, statusMap } = await this.presence.getOnlineIdsAndStatus(tenantId);
    this.emitter.emitPresence(tenantId, onlineIds, statusMap);
  }

  afterInit() {
    this.emitter.setServer(this.server);
    this.presenceCheckInterval = setInterval(async () => {
      const tenantIds = await this.presence.getTenantIdsAsync();
      for (const t of tenantIds) {
        await this.emitPresenceToTenant(t);
      }
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
    this.logger.log('WebSocket gateway initialized (chat + presence)');
  }

  async handleDisconnect(client: any) {
    const info = this.presence.remove(client.id);
    if (info) {
      await this.emitPresenceToTenant(info.tenantId);
      // Redistribui tickets ao agente desconectar
      if (this.assignmentSvc) {
        this.assignmentSvc.redistributeOnAgentOffline(info.tenantId, info.userId).catch(() => {});
      }
      // Clock-out automático após grace period (60s) — cancela se reconectar
      if (this.attendanceSvc) {
        const key = `${info.tenantId}:${info.userId}`;
        const existing = this.pendingClockOuts.get(key);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(async () => {
          this.pendingClockOuts.delete(key);
          try {
            await this.attendanceSvc.clockOut(info.tenantId, info.userId, 'Desconexão detectada');
          } catch {}
        }, 60_000);
        this.pendingClockOuts.set(key, timer);
      }
    }
  }

  @SubscribeMessage('join-ticket')
  handleJoinTicket(client: any, payload: { ticketId: string }) {
    const { ticketId } = payload || {};
    if (ticketId) {
      client.join(`ticket:${ticketId}`);
    }
  }

  @SubscribeMessage('leave-ticket')
  handleLeaveTicket(client: any, payload: { ticketId: string }) {
    const { ticketId } = payload || {};
    if (ticketId) {
      client.leave(`ticket:${ticketId}`);
    }
  }

  @SubscribeMessage('join-conversation')
  handleJoinConversation(client: any, payload: { conversationId: string }) {
    const { conversationId } = payload || {};
    if (conversationId) {
      client.join(`conversation:${conversationId}`);
    }
  }

  @SubscribeMessage('leave-conversation')
  handleLeaveConversation(client: any, payload: { conversationId: string }) {
    const { conversationId } = payload || {};
    if (conversationId) {
      client.leave(`conversation:${conversationId}`);
    }
  }

  @SubscribeMessage('join-tenant')
  async handleJoinTenant(client: any, payload: {
    tenantId: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    userRole?: string;
  }) {
    const { tenantId, userId, userName, userEmail, userRole } = payload || {};
    if (tenantId && userId) {
      const current = this.presence.getSocketInfo(client.id);

      // Se o socket veio de outra empresa, sai da sala anterior antes de entrar na nova.
      // Isso evita que um mesmo socket continue recebendo eventos da empresa antiga.
      if (current && (current.tenantId !== tenantId || current.userId !== String(userId))) {
        client.leave(`tenant:${current.tenantId}`);
        this.clearPendingClockOut(current.tenantId, current.userId);
        this.presence.remove(client.id);
        await this.emitPresenceToTenant(current.tenantId);
      }

      // Cancela clock-out pendente da empresa atual (reconexão dentro do grace period)
      this.clearPendingClockOut(tenantId, String(userId));

      client.join(`tenant:${tenantId}`);
      this.presence.add(tenantId, String(userId), client.id);
      const { onlineIds, statusMap } = await this.presence.getOnlineIdsAndStatus(tenantId);
      this.emitter.emitPresence(tenantId, onlineIds, statusMap);
      client.emit('internal-chat:presence', { onlineIds, statusMap });

      // Garante clock-in ativo — recupera sessão caso tenha sido encerrada por refresh/beacon acidental
      if (this.attendanceSvc && userName && userEmail) {
        try {
          await this.attendanceSvc.clockIn(tenantId, String(userId), userName, userEmail, userRole || 'agent');
        } catch {}
      }

      // Rebalanceia tickets pendentes ao agente entrar online
      if (this.assignmentSvc) {
        this.assignmentSvc.rebalanceOnAgentOnline(tenantId, String(userId)).catch(() => {});
      }
    }
  }

  @SubscribeMessage('leave-tenant')
  async handleLeaveTenant(client: any, payload: { tenantId: string; userId?: string }) {
    const { tenantId, userId } = payload || {};
    const current = this.presence.getSocketInfo(client.id);
    if (tenantId && userId && current && current.tenantId === tenantId && current.userId === String(userId)) {
      client.leave(`tenant:${tenantId}`);
      this.clearPendingClockOut(tenantId, String(userId));
      this.presence.remove(client.id);
      await this.emitPresenceToTenant(tenantId);
    }
  }

  @SubscribeMessage('presence:heartbeat')
  async handlePresenceHeartbeat(client: any, payload: { tenantId?: string; userId?: string }) {
    const { tenantId, userId } = payload || {};
    const info = this.presence.getSocketInfo(client.id);
    const tid = tenantId || info?.tenantId;
    const uid = userId || info?.userId;
    if (tid && uid && (await this.presence.heartbeatAsync(tid, uid, client.id))) {
      await this.emitPresenceToTenant(tid);
    }
  }

  @SubscribeMessage('presence:set-status')
  async handlePresenceSetStatus(client: any, payload: { status: 'online' | 'away' | 'busy' }) {
    const info = this.presence.getSocketInfo(client.id);
    if (!info || !payload?.status) return;
    if (await this.presence.setStatusAsync(info.tenantId, info.userId, payload.status)) {
      await this.emitPresenceToTenant(info.tenantId);
    }
  }

  /** Agente está digitando → envia "composing" para o contato via WhatsApp */
  @SubscribeMessage('typing:agent')
  async handleAgentTyping(client: any, payload: { contactPhone: string; tenantId: string; isTyping: boolean }) {
    const { contactPhone, tenantId, isTyping } = payload || {};
    if (!contactPhone || !tenantId || !this.baileysSvc) return;
    try {
      await this.baileysSvc.sendPresenceUpdate(tenantId, contactPhone, isTyping ? 'composing' : 'paused');
    } catch {}
  }

  /** Assina presença de um contato para receber eventos "digitando..." dele */
  @SubscribeMessage('subscribe:presence')
  async handleSubscribePresence(client: any, payload: { jid: string; tenantId: string }) {
    const { jid, tenantId } = payload || {};
    if (!jid || !tenantId || !this.baileysSvc) return;
    try {
      await this.baileysSvc.subscribePresence(tenantId, jid);
    } catch {}
  }
}
