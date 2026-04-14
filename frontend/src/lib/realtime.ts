'use client';
import { useEffect, useRef, useCallback } from 'react';
import { resolveWsBase } from './ws-base';

// Deploy conservador: manter o realtime ativo enquanto o frontend ainda
// depende dele em fluxos críticos. Os detalhes de ticket usam polling leve
// como fallback para não ficarem "mortos" se o socket oscilar.
export const REALTIME_ENABLED = true;

/**
 * JWT para Socket.IO: o painel grava em `accessToken`; o portal do cliente usa
 * Zustand persist na chave `portal-auth` (state.accessToken apenas).
 */
function readAccessTokenFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  const direct = window.localStorage.getItem('accessToken');
  if (direct) return direct;
  try {
    const raw = window.localStorage.getItem('portal-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { accessToken?: string | null } };
    const t = parsed?.state?.accessToken;
    return typeof t === 'string' && t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

// ── Singleton: uma única conexão socket.io para toda a sessão ─────────────────
// Hooks apenas emitem join/leave para trocar de sala, sem disconnect/reconnect.
let _sharedSocket: any = null;

async function getSharedSocket(): Promise<any | null> {
  if (!REALTIME_ENABLED) return null;
  const base = resolveWsBase();
  if (!base) return null;
  const token = readAccessTokenFromStorage();
  if (!token) return null;
  if (_sharedSocket) return _sharedSocket;
  const { io } = await import('socket.io-client');
  _sharedSocket = io(`${base}/realtime`, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { token },
  });
  return _sharedSocket;
}

/** Mesma conexão usada por useRealtimeTicket / useRealtimeConversation — presença deve usar esta instância. */
export function getSharedRealtimeSocket(): Promise<any | null> {
  return getSharedSocket();
}

// ── useRealtimeTicket ──────────────────────────────────────────────────────────
export function useRealtimeTicket(ticketId: string | null, onMessage: (msg: any) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!REALTIME_ENABLED) return;
    if (!ticketId || !resolveWsBase()) return;

    let active = true;
    let handler: ((msg: any) => void) | null = null;

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      socket.emit('join-ticket', { ticketId });
      handler = (msg: any) => onMessageRef.current(msg);
      socket.on('ticket:message', handler);
    });

    return () => {
      active = false;
      if (_sharedSocket && handler) {
        _sharedSocket.emit('leave-ticket', { ticketId });
        _sharedSocket.off('ticket:message', handler);
      }
    };
  }, [ticketId]);

  const joinTicket = useCallback((id: string) => {
    if (_sharedSocket?.connected) _sharedSocket.emit('join-ticket', { ticketId: id });
  }, []);

  return { joinTicket };
}

// ── useRealtimeTicketUpdated ───────────────────────────────────────────────────
// Escuta 'ticket:updated' na sala ticket:<id> para sincronizar campos como assignedTo,
// status, prioridade etc. em tempo real sem depender do poll de 15 segundos.
export function useRealtimeTicketUpdated(ticketId: string | null, onUpdate: (patch: any) => void) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!REALTIME_ENABLED) return;
    if (!ticketId || !resolveWsBase()) return;

    let active = true;
    let handler: ((patch: any) => void) | null = null;

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      // A sala já foi entrada por useRealtimeTicket — apenas adiciona o listener
      handler = (patch: any) => onUpdateRef.current(patch);
      socket.on('ticket:updated', handler);
    });

    return () => {
      active = false;
      if (_sharedSocket && handler) {
        _sharedSocket.off('ticket:updated', handler);
      }
    };
  }, [ticketId]);
}

// ── useRealtimeConversation ────────────────────────────────────────────────────
export function useRealtimeConversation(conversationId: string | null, onMessage: (msg: any) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!REALTIME_ENABLED) return;
    if (!conversationId || !resolveWsBase()) return;

    let active = true;
    let handler: ((msg: any) => void) | null = null;

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      socket.emit('join-conversation', { conversationId });
      handler = (msg: any) => onMessageRef.current(msg);
      socket.on('conversation:message', handler);
    });

    return () => {
      active = false;
      if (_sharedSocket && handler) {
        _sharedSocket.emit('leave-conversation', { conversationId });
        _sharedSocket.off('conversation:message', handler);
      }
    };
  }, [conversationId]);

  return {};
}

// ── Base para futuro realtime de status ───────────────────────────────────────
/**
 * Prepara assinatura de atualizações de status de mensagens.
 * Atualmente as atualizações chegam via ticket:message / conversation:message com o mesmo ID.
 * No futuro, o backend pode emitir 'message-status' separadamente.
 */
export function subscribeToMessageUpdates(
  _chatId: string | null,
  _onUpdate: (messageId: string, status: string) => void,
): () => void {
  return () => {};
}

// ── useRealtimeConversationClosed ─────────────────────────────────────────────
/**
 * Escuta o evento 'conversation:closed' emitido para a sala tenant:<tenantId>.
 * Disparado quando um ticket vinculado é resolvido/encerrado, fechando a conversa.
 * O frontend usa para remover automaticamente a conversa do inbox ativo.
 */
export function useRealtimeConversationClosed(
  onClosed: (conversationId: string) => void,
) {
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    if (!REALTIME_ENABLED) return;
    if (!resolveWsBase()) return;

    let active = true;
    let handler: ((payload: any) => void) | null = null;

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      handler = (payload: any) => {
        if (payload?.conversationId) onClosedRef.current(payload.conversationId);
      };
      socket.on('conversation:closed', handler);
    });

    return () => {
      active = false;
      if (_sharedSocket && handler) {
        _sharedSocket.off('conversation:closed', handler);
      }
    };
  }, []);
}

// ── useRealtimeTicketAssigned ──────────────────────────────────────────────────
/**
 * Escuta o evento 'ticket:assigned' emitido para a sala tenant:<tenantId>.
 * Disparado quando um ticket é atribuído/transferido para um agente.
 * O frontend usa para: mostrar toast ao agente que recebeu, recarregar inbox,
 * e remover do inbox do agente anterior (se for o caso).
 */
export function useRealtimeTicketAssigned(
  onAssigned: (payload: {
    ticketId: string;
    ticketNumber: string | null;
    subject: string | null;
    assignedTo: string;
    assignedToName: string;
    prevAssignedTo: string | null;
    assignedBy: string;
    assignedByName: string;
  }) => void,
) {
  const onAssignedRef = useRef(onAssigned);
  onAssignedRef.current = onAssigned;

  useEffect(() => {
    if (!REALTIME_ENABLED) return;
    if (!resolveWsBase()) return;

    let active = true;
    let handler: ((payload: any) => void) | null = null;

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      handler = (payload: any) => {
        if (payload) onAssignedRef.current(payload);
      };
      socket.on('ticket:assigned', handler);
    });

    return () => {
      active = false;
      if (_sharedSocket && handler) {
        _sharedSocket.off('ticket:assigned', handler);
      }
    };
  }, []);
}

// ── Typing presence helpers ────────────────────────────────────────────────────
/**
 * Emite evento de "agente digitando" (ou parou) para o contato via WhatsApp.
 * O backend repassa via sock.sendPresenceUpdate('composing'|'paused', jid).
 */
export function emitTypingPresence(contactPhone: string, tenantId: string, isTyping: boolean) {
  if (!REALTIME_ENABLED) return;
  if (_sharedSocket?.connected) {
    _sharedSocket.emit('typing:agent', { contactPhone, tenantId, isTyping });
  }
}

/**
 * Assina presença de um contato para receber eventos "digitando..." dele.
 * Deve ser chamado quando o agente abre uma conversa WhatsApp.
 */
export function subscribeContactPresence(jid: string, tenantId: string) {
  if (!REALTIME_ENABLED) return;
  if (_sharedSocket?.connected) {
    _sharedSocket.emit('subscribe:presence', { jid, tenantId });
  }
}

// ── useRealtimeContactTyping ───────────────────────────────────────────────────
/**
 * Escuta o evento 'contact:typing' emitido pelo backend quando um contato WhatsApp
 * começa ou para de digitar. Filtra pelo número de telefone do contato ativo.
 */
export function useRealtimeContactTyping(
  contactPhone: string | null,
  onTyping: (isTyping: boolean) => void,
) {
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;

  useEffect(() => {
    if (!REALTIME_ENABLED) return;
    if (!resolveWsBase()) return;

    let active = true;
    let handler: ((payload: any) => void) | null = null;

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      handler = (payload: any) => {
        if (!payload || !contactPhone) return;
        // Compara os últimos dígitos (ignora prefixo de país e variações)
        const fromDigits = String(payload.phone || '').replace(/\D/g, '');
        const targetDigits = String(contactPhone || '').replace(/\D/g, '');
        if (!fromDigits || !targetDigits) return;
        // Aceita correspondência por sufixo (ex: 11999990000 == 5511999990000)
        const match =
          fromDigits === targetDigits ||
          fromDigits.endsWith(targetDigits.slice(-10)) ||
          targetDigits.endsWith(fromDigits.slice(-10));
        if (match) onTypingRef.current(payload.isTyping ?? false);
      };
      socket.on('contact:typing', handler);
    });

    return () => {
      active = false;
      if (_sharedSocket && handler) _sharedSocket.off('contact:typing', handler);
    };
  }, [contactPhone]);
}

// ── useRealtimeTenantNewMessages ───────────────────────────────────────────────
/**
 * Escuta o evento 'new-message' emitido para a sala tenant:<tenantId>.
 * O agente já está na sala do tenant via PresenceProvider (join-tenant).
 * Usado para badges e sons de novas mensagens em conversas não selecionadas.
 */
export function useRealtimeTenantNewMessages(
  onMessage: (msg: { conversationId: string; contactName: string; preview: string; channel: string }) => void,
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!REALTIME_ENABLED) return;
    if (!resolveWsBase()) return;

    let active = true;
    let handler: ((msg: any) => void) | null = null;

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      handler = (msg: any) => { if (msg) onMessageRef.current(msg); };
      socket.on('new-message', handler);
    });

    return () => {
      active = false;
      if (_sharedSocket && handler) {
        _sharedSocket.off('new-message', handler);
      }
    };
  }, []);
}

// ── Hooks de Pausas de Agente ─────────────────────────────────────────────────

export type PauseStatusChangedPayload = {
  pauseRequestId: string;
  agentId: string;
  status: 'active' | 'rejected' | 'finished' | 'cancelled';
  reviewerName?: string;
  reviewerObservation?: string;
};

export type PauseRequestedPayload = {
  pauseRequestId: string;
  agentId: string;
  agentName: string;
  reasonName: string;
  agentObservation?: string;
  requestedAt: string;
};

/**
 * Escuta mudanças de status de pausa do próprio agente.
 * Backend emite 'pause:status-changed' para toda a sala tenant.
 * O frontend filtra pelo agentId do usuário logado.
 */
export function useRealtimeMyPauseStatus(
  myUserId: string | null,
  onChange: (payload: PauseStatusChangedPayload) => void,
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!REALTIME_ENABLED || !myUserId) return;
    if (!resolveWsBase()) return;

    let active = true;
    let handler: ((p: any) => void) | null = null;

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      handler = (payload: any) => {
        if (!payload || payload.agentId !== myUserId) return;
        onChangeRef.current(payload);
      };
      socket.on('pause:status-changed', handler);
    });

    return () => {
      active = false;
      if (_sharedSocket && handler) _sharedSocket.off('pause:status-changed', handler);
    };
  }, [myUserId]);
}

/**
 * Escuta novas solicitações de pausa — para o painel do supervisor.
 * Backend emite 'pause:requested' para toda a sala tenant.
 */
export function useRealtimePauseRequested(
  onRequested: (payload: PauseRequestedPayload) => void,
) {
  const onRef = useRef(onRequested);
  onRef.current = onRequested;

  useEffect(() => {
    if (!REALTIME_ENABLED) return;
    if (!resolveWsBase()) return;

    let active = true;
    let handler: ((p: any) => void) | null = null;

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      handler = (payload: any) => { if (payload) onRef.current(payload); };
      socket.on('pause:requested', handler);
    });

    return () => {
      active = false;
      if (_sharedSocket && handler) _sharedSocket.off('pause:requested', handler);
    };
  }, []);
}

/**
 * Escuta todos os eventos de pausa para o supervisor manter a lista atualizada.
 * Eventos: pause:approved, pause:rejected, pause:ended, pause:cancelled
 */
export function useRealtimePauseEvents(
  onEvent: (event: string, payload: any) => void,
) {
  const onRef = useRef(onEvent);
  onRef.current = onEvent;

  useEffect(() => {
    if (!REALTIME_ENABLED) return;
    if (!resolveWsBase()) return;

    let active = true;
    const handlers: Record<string, (p: any) => void> = {};
    const EVENTS = ['pause:approved', 'pause:rejected', 'pause:ended', 'pause:cancelled'];

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      for (const ev of EVENTS) {
        const h = (payload: any) => { if (payload) onRef.current(ev, payload); };
        handlers[ev] = h;
        socket.on(ev, h);
      }
    });

    return () => {
      active = false;
      if (_sharedSocket) {
        for (const ev of EVENTS) {
          if (handlers[ev]) _sharedSocket.off(ev, handlers[ev]);
        }
      }
    };
  }, []);
}
