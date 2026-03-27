'use client';
import { useEffect, useRef, useCallback } from 'react';

const WS_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL
      ? process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/v1\/?$/, '')
      : window.location.origin)
  : '';

// ── Singleton: uma única conexão socket.io para toda a sessão ─────────────────
// Hooks apenas emitem join/leave para trocar de sala, sem disconnect/reconnect.
let _sharedSocket: any = null;

async function getSharedSocket(): Promise<any | null> {
  if (!WS_BASE) return null;
  if (_sharedSocket) return _sharedSocket;
  const { io } = await import('socket.io-client');
  _sharedSocket = io(`${WS_BASE}/realtime`, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });
  return _sharedSocket;
}

// ── useRealtimeTicket ──────────────────────────────────────────────────────────
export function useRealtimeTicket(ticketId: string | null, onMessage: (msg: any) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!ticketId || !WS_BASE) return;

    let active = true;
    let handler: ((msg: any) => void) | null = null;

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      socket.emit('join-ticket', { ticketId });
      handler = (msg: any) => onMessageRef.current(msg);
      socket.on('message', handler);
    });

    return () => {
      active = false;
      if (_sharedSocket && handler) {
        _sharedSocket.emit('leave-ticket', { ticketId });
        _sharedSocket.off('message', handler);
      }
    };
  }, [ticketId]);

  const joinTicket = useCallback((id: string) => {
    if (_sharedSocket?.connected) _sharedSocket.emit('join-ticket', { ticketId: id });
  }, []);

  return { joinTicket };
}

// ── useRealtimeConversation ────────────────────────────────────────────────────
export function useRealtimeConversation(conversationId: string | null, onMessage: (msg: any) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!conversationId || !WS_BASE) return;

    let active = true;
    let handler: ((msg: any) => void) | null = null;

    getSharedSocket().then((socket) => {
      if (!active || !socket) return;
      socket.emit('join-conversation', { conversationId });
      handler = (msg: any) => onMessageRef.current(msg);
      socket.on('message', handler);
    });

    return () => {
      active = false;
      if (_sharedSocket && handler) {
        _sharedSocket.emit('leave-conversation', { conversationId });
        _sharedSocket.off('message', handler);
      }
    };
  }, [conversationId]);

  return {};
}

// ── Base para futuro realtime de status ───────────────────────────────────────
/**
 * Prepara assinatura de atualizações de status de mensagens.
 * Atualmente as atualizações chegam via evento 'message' com o mesmo ID.
 * No futuro, o backend pode emitir 'message-status' separadamente.
 */
export function subscribeToMessageUpdates(
  _chatId: string | null,
  _onUpdate: (messageId: string, status: string) => void,
): () => void {
  return () => {};
}
