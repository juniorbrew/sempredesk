'use client';
import { useEffect, useRef, useCallback } from 'react';

const WS_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL
      ? process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/v1\/?$/, '')
      : window.location.origin)
  : '';

export function useRealtimeTicket(ticketId: string | null, onMessage: (msg: any) => void) {
  const socketRef = useRef<any>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!ticketId || !WS_BASE) return;

    let socket: any;
    const init = async () => {
      const { io } = await import('socket.io-client');
      socket = io(`${WS_BASE}/realtime`, { path: '/socket.io', transports: ['websocket', 'polling'] });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('join-ticket', { ticketId });
      });

      socket.on('message', (msg: any) => {
        onMessageRef.current(msg);
      });
    };
    init();
    return () => {
      if (socket) {
        socket.emit('leave-ticket', { ticketId });
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [ticketId]);

  const joinTicket = useCallback((id: string) => {
    if (socketRef.current?.connected) socketRef.current.emit('join-ticket', { ticketId: id });
  }, []);

  return { joinTicket };
}

export function useRealtimeConversation(conversationId: string | null, onMessage: (msg: any) => void) {
  const socketRef = useRef<any>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!conversationId || !WS_BASE) return;

    let socket: any;
    const init = async () => {
      const { io } = await import('socket.io-client');
      socket = io(`${WS_BASE}/realtime`, { path: '/socket.io', transports: ['websocket', 'polling'] });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('join-conversation', { conversationId });
      });

      socket.on('message', (msg: any) => {
        onMessageRef.current(msg);
      });
    };
    init();
    return () => {
      if (socket) {
        socket.emit('leave-conversation', { conversationId });
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [conversationId]);

  return {};
}
