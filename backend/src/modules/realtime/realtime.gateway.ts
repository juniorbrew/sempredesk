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
import { TicketViewersService } from './ticket-viewers.service';
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

  /**
   * Rastreia os ticketIds que cada socket está visualizando.
   * Chave: socketId → Set<ticketId>
   * Usado para limpar visualizações na desconexão sem precisar
   * consultar o Redis por padrão (economiza round-trips).
   */
  private readonly socketTickets = new Map<string, Set<string>>();

  constructor(
    private readonly emitter: RealtimeEmitterService,
    private readonly presence: RealtimePresenceService,
    private readonly ticketViewers: TicketViewersService,
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
    // Remove visualizações de tickets antes de apagar o socketInfo do presence
    const ticketIds = Array.from(this.socketTickets.get(client.id) ?? []);
    this.socketTickets.delete(client.id);

    const info = this.presence.remove(client.id);
    if (info) {
      await this.emitPresenceToTenant(info.tenantId);

      // Limpa viewers de todos os tickets que este agente estava visualizando
      if (ticketIds.length > 0) {
        const updates = await this.ticketViewers.removeUserFromTickets(
          info.tenantId,
          info.userId,
          ticketIds,
        );
        for (const { ticketId, viewers } of updates) {
          this.emitter.emitTicketViewers(ticketId, viewers);
        }
      }

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
  async handleJoinTicket(
    client: any,
    payload: { ticketId: string; userName?: string },
  ) {
    const { ticketId, userName } = payload || {};
    if (!ticketId) return;

    client.join(`ticket:${ticketId}`);

    // Rastreia localmente quais tickets este socket está vendo
    let ticketSet = this.socketTickets.get(client.id);
    if (!ticketSet) {
      ticketSet = new Set<string>();
      this.socketTickets.set(client.id, ticketSet);
    }
    ticketSet.add(ticketId);

    // Registra viewer no Redis e emite lista atualizada para a sala
    const socketInfo = this.presence.getSocketInfo(client.id);
    if (socketInfo) {
      const viewers = await this.ticketViewers.addViewer(
        socketInfo.tenantId,
        ticketId,
        socketInfo.userId,
        userName || socketInfo.userId,
      );
      this.emitter.emitTicketViewers(ticketId, viewers);
    }
  }

  @SubscribeMessage('leave-ticket')
  async handleLeaveTicket(client: any, payload: { ticketId: string }) {
    const { ticketId } = payload || {};
    if (!ticketId) return;

    client.leave(`ticket:${ticketId}`);

    // Remove rastreamento local
    this.socketTickets.get(client.id)?.delete(ticketId);

    // Remove viewer do Redis e emite lista atualizada
    const socketInfo = this.presence.getSocketInfo(client.id);
    if (socketInfo) {
      const viewers = await this.ticketViewers.removeViewer(
        socketInfo.tenantId,
        ticketId,
        socketInfo.userId,
      );
      this.emitter.emitTicketViewers(ticketId, viewers);
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
