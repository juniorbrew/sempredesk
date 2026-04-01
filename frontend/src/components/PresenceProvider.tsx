'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { usePresenceStore } from '@/store/presence.store';
import { resolveWsBase } from '@/lib/ws-base';

const HEARTBEAT_INTERVAL_MS = 15_000;
const POLL_INTERVAL_MS = 10_000;

type PresenceStatus = 'online' | 'away' | 'busy';

interface PresenceContextValue {
  setStatus: (status: PresenceStatus) => void;
  isConnected: boolean;
}

const PresenceContext = createContext<PresenceContextValue>({
  setStatus: () => {},
  isConnected: false,
});

export function usePresence() {
  return useContext(PresenceContext);
}

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const setPresence = usePresenceStore((s) => s.setPresence);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<any>(null);
  const tenantIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  if (user?.tenantId && user?.id) {
    tenantIdRef.current = user.tenantId;
    userIdRef.current = user.id;
  }

  const setStatus = useCallback((status: PresenceStatus) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('presence:set-status', { status });
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const tenantId = tenantIdRef.current;
    const userId = userIdRef.current;
    if (!token || !tenantId || !userId) return;

    let socket: any;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const loadPresence = async () => {
      try {
        const { api } = await import('@/lib/api');
        const res: any = await api.getPresence().catch(() => api.getInternalChatOnline());
        const ids = Array.isArray(res?.onlineIds) ? res.onlineIds : (Array.isArray(res?.data?.onlineIds) ? res.data.onlineIds : []);
        const statusMap = res?.statusMap || res?.data?.statusMap || {};
        setPresence(ids.map((id: unknown) => String(id)), statusMap);
      } catch {}
    };

    const startPoll = () => {
      if (pollInterval) return;
      loadPresence();
      pollInterval = setInterval(loadPresence, POLL_INTERVAL_MS);
    };

    const stopPoll = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    (async () => {
      loadPresence();
      const base = resolveWsBase();
      if (!base) return;
      const { io } = await import('socket.io-client');
      socket = io(`${base}/realtime`, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: { token },
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        stopPoll();
        setIsConnected(true);
        // Passa dados completos do usuário para o backend poder fazer clock-in automático se necessário
        const u = useAuthStore.getState().user;
        socket.emit('join-tenant', {
          tenantId,
          userId: String(userId),
          userName: u?.name,
          userEmail: u?.email,
          userRole: u?.role,
        });
        setTimeout(loadPresence, 500);
        heartbeatInterval = setInterval(() => {
          if (socket?.connected) socket.emit('presence:heartbeat', { tenantId, userId: String(userId) });
        }, HEARTBEAT_INTERVAL_MS);
      });

      socket.on('disconnect', () => {
        setIsConnected(false);
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        startPoll();
      });

      socket.on('internal-chat:presence', (data: { onlineIds?: string[]; statusMap?: Record<string, string> }) => {
        if (data?.onlineIds) setPresence(data.onlineIds.map((id: unknown) => String(id)), data.statusMap);
      });
    })();

    return () => {
      stopPoll();
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      socketRef.current = null;
      if (socket) {
        const tid = tenantIdRef.current;
        const uid = userIdRef.current;
        if (tid && uid) socket.emit('leave-tenant', { tenantId: tid, userId: String(uid) });
        socket.disconnect();
      }
      setIsConnected(false);
      setPresence([], {});
    };
  }, [user?.tenantId, user?.id, setPresence]);

  return (
    <PresenceContext.Provider value={{ setStatus, isConnected }}>
      {children}
    </PresenceContext.Provider>
  );
}
