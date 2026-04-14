import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import type { TicketViewer } from './ticket-viewers.service';

/**
 * Serviço para emitir eventos WebSocket de forma desacoplada.
 * O ChatGateway injeta o Server em afterInit().
 * Usado por TicketsService ao adicionar mensagens (chat + WhatsApp).
 */
@Injectable()
export class RealtimeEmitterService {
  private server: Server | null = null;

  setServer(server: Server) {
    this.server = server;
  }

  /**
   * Emite nova mensagem para a sala do ticket (chat e WhatsApp em tempo real).
   * Evento dedicado evita colisão com conversation:message no mesmo socket.
   */
  emitNewMessage(ticketId: string, message: Record<string, any>) {
    if (!this.server) return;
    this.server.to(`ticket:${ticketId}`).emit('ticket:message', message);
  }

  /**
   * Emite nova mensagem para a sala da conversa (chat portal em tempo real).
   */
  emitNewConversationMessage(conversationId: string, message: Record<string, any>) {
    if (!this.server) return;
    this.server.to(`conversation:${conversationId}`).emit('conversation:message', message);
  }

  /**
   * Notificação in-app (sino) para agentes na sala tenant — não usar o mesmo nome que
   * ticket:message na sala ticket, para não processar broadcast como mensagem da sala atual.
   */
  emitTenantTicketMessageNotify(
    tenantId: string,
    data: { ticketId: string; ticketNumber: string; content: string },
  ) {
    if (!this.server) return;
    this.server.to(`tenant:${tenantId}`).emit('notification:ticket-message', data);
  }

  /**
   * Emite para tenant (atendentes) - nova conversa/mensagem para listar.
   */
  emitToTenant(tenantId: string, event: string, payload: any) {
    if (!this.server) return;
    this.server.to(`tenant:${tenantId}`).emit(event, payload);
  }

  /**
   * Emite nova mensagem do chat interno para o tenant (sender e recipient recebem).
   */
  emitInternalChatMessage(tenantId: string, message: Record<string, any>) {
    if (!this.server) return;
    this.server.to(`tenant:${tenantId}`).emit('internal-chat:message', message);
  }

  /**
   * Emite lista de usuários online para o tenant (presença no chat interno).
   * Mantém backward compat: onlineIds. statusMap opcional para indicadores visuais.
   */
  emitPresence(tenantId: string, onlineIds: string[], statusMap?: Record<string, string>) {
    if (!this.server) return;
    this.server.to(`tenant:${tenantId}`).emit('internal-chat:presence', {
      onlineIds,
      statusMap: statusMap || {},
    });
  }

  /**
   * Emite atualização de campos do ticket para a sala ticket:<id>.
   * Usado quando assignedTo, status ou outros campos mudam externamente
   * (round-robin, transferência manual) para manter o frontend sincronizado.
   */
  emitTicketUpdated(ticketId: string, patch: Record<string, any>) {
    if (!this.server) return;
    this.server.to(`ticket:${ticketId}`).emit('ticket:updated', { ticketId, ...patch });
  }

  /**
   * Emite a lista de agentes visualizando um ticket no momento.
   * Todos os sockets na sala ticket:{ticketId} recebem o evento "ticket:viewers".
   *
   * O frontend usa isso para exibir o aviso
   * "Agente X também está visualizando este atendimento".
   */
  emitTicketViewers(ticketId: string, viewers: TicketViewer[]) {
    if (!this.server) return;
    this.server.to(`ticket:${ticketId}`).emit('ticket:viewers', { ticketId, viewers });
  }
}
