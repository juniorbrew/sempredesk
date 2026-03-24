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

  constructor(
    private readonly emitter: RealtimeEmitterService,
    private readonly presence: RealtimePresenceService,
  ) {}

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
  async handleJoinTenant(client: any, payload: { tenantId: string; userId?: string }) {
    const { tenantId, userId } = payload || {};
    if (tenantId && userId) {
      client.join(`tenant:${tenantId}`);
      this.presence.add(tenantId, String(userId), client.id);
      const { onlineIds, statusMap } = await this.presence.getOnlineIdsAndStatus(tenantId);
      this.emitter.emitPresence(tenantId, onlineIds, statusMap);
      client.emit('internal-chat:presence', { onlineIds, statusMap });
      // Rebalanceia tickets pendentes ao agente entrar online
      if (this.assignmentSvc) {
        this.assignmentSvc.rebalanceOnAgentOnline(tenantId, String(userId)).catch(() => {});
      }
    }
  }

  @SubscribeMessage('leave-tenant')
  async handleLeaveTenant(client: any, payload: { tenantId: string; userId?: string }) {
    const { tenantId, userId } = payload || {};
    if (tenantId && userId) {
      client.leave(`tenant:${tenantId}`);
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
}
