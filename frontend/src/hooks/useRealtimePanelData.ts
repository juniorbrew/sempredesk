'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { REALTIME_ENABLED } from '@/lib/realtime';
import { usePresenceStore } from '@/store/presence.store';
import type { ConvRow, QueueStatsPayload } from '@/lib/realtime-panel-filters';
import toast from 'react-hot-toast';

/**
 * Dados do painel Real-Time (fila + conversas ativas + fechadas + equipa).
 * Sem alterar APIs — apenas consome endpoints existentes.
 */
export function useRealtimePanelData() {
  const [stats, setStats] = useState<QueueStatsPayload | null>(null);
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [closedConvs, setClosedConvs] = useState<ConvRow[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);
  const [lastAt, setLastAt] = useState<Date | null>(null);

  const onlineIds = usePresenceStore((s) => s.onlineIds);
  const prevPresenceSize = useRef(onlineIds.size);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [statsRes, convRes, closedRes, teamRes] = await Promise.all([
        api.getAttendanceQueueStats(),
        api.getConversations({ status: 'active' }),
        api.getConversations({ status: 'closed' }).catch(() => []),
        api.getTeam(),
      ]);
      setStats(statsRes as unknown as QueueStatsPayload);
      const ca: ConvRow[] = Array.isArray(convRes) ? convRes : (convRes as any)?.data ?? [];
      setConvs(
        ca.sort(
          (a, b) =>
            new Date(b.lastMessageAt || b.createdAt || 0).getTime() -
            new Date(a.lastMessageAt || a.createdAt || 0).getTime(),
        ),
      );
      const cc: ConvRow[] = Array.isArray(closedRes) ? closedRes : (closedRes as any)?.data ?? [];
      setClosedConvs(
        cc.sort(
          (a, b) =>
            new Date(b.lastMessageAt || b.updatedAt || b.createdAt || 0).getTime() -
            new Date(a.lastMessageAt || a.updatedAt || a.createdAt || 0).getTime(),
        ),
      );
      setTeam(Array.isArray(teamRes) ? teamRes : (teamRes as any)?.data ?? []);
      setLastAt(new Date());
    } catch (e) {
      console.error(e);
      toast.error('Não foi possível carregar o painel em tempo real');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => load(true), 15_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (prevPresenceSize.current !== onlineIds.size) {
      prevPresenceSize.current = onlineIds.size;
      load(true);
    }
  }, [onlineIds, load]);

  useEffect(() => {
    if (!REALTIME_ENABLED) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    let socket: any;
    (async () => {
      const { resolveWsBase } = await import('@/lib/ws-base');
      const WS_BASE = resolveWsBase();
      if (!token || !WS_BASE) return;
      const { io } = await import('socket.io-client');
      const user = (await import('@/store/auth.store')).useAuthStore.getState().user;
      if (!user?.tenantId) return;
      socket = io(`${WS_BASE}/realtime`, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: { token },
      });
      socket.emit('join-tenant', { tenantId: user.tenantId, userId: user.id });
      socket.on('queue:updated', () => load(true));
    })();
    return () => {
      if (socket) socket.disconnect();
    };
  }, [load]);

  const mergedForProductivity = useMemo(() => {
    const m = new Map<string, ConvRow>();
    for (const c of convs) m.set(c.id, c);
    for (const c of closedConvs) {
      if (!m.has(c.id)) m.set(c.id, c);
    }
    return [...m.values()];
  }, [convs, closedConvs]);

  return {
    stats,
    convs,
    closedConvs,
    mergedForProductivity,
    team,
    loading,
    load,
    lastAt,
  };
}
