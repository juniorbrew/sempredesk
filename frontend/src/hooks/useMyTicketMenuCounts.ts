'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { MY_OPEN_TICKETS_REFRESH_EVENT } from './useMyOpenTicketsCount';

type TicketMenuCounts = {
  atendimentoCount: number;
  ticketsCount: number;
};

/**
 * Contadores do menu lateral por agente autenticado.
 * - Atendimento: tickets ativos atribuídos ao agente
 * - Tickets: tickets resolvidos/fechados atribuídos ao agente
 */
export function useMyTicketMenuCounts(pollMs = 60_000) {
  const user = useAuthStore((s) => s.user);
  const [counts, setCounts] = useState<TicketMenuCounts>({
    atendimentoCount: 0,
    ticketsCount: 0,
  });

  const fetchCounts = useCallback(async () => {
    if (!user?.id) {
      setCounts({ atendimentoCount: 0, ticketsCount: 0 });
      return;
    }

    try {
      const [openRes, closedRes] = await Promise.allSettled([
        api.getMyOpenAssignedTicketsCount(),
        api.getTickets({
          assignedTo: user.id,
          status: 'resolved,closed',
          perPage: 1,
          page: 1,
        }),
      ]);

      const openPayload = openRes.status === 'fulfilled' ? openRes.value : null;
      const closedPayload = closedRes.status === 'fulfilled' ? closedRes.value : null;
      const openCountRaw = typeof (openPayload as any)?.count === 'number'
        ? (openPayload as any).count
        : Number((openPayload as any)?.data?.count);
      const closedTotalRaw = typeof (closedPayload as any)?.total === 'number'
        ? (closedPayload as any).total
        : Number((closedPayload as any)?.data?.total);

      setCounts({
        atendimentoCount: Number.isFinite(openCountRaw) && openCountRaw >= 0 ? openCountRaw : 0,
        ticketsCount: Number.isFinite(closedTotalRaw) && closedTotalRaw >= 0 ? closedTotalRaw : 0,
      });
    } catch {
      setCounts({ atendimentoCount: 0, ticketsCount: 0 });
    }
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined' || !localStorage.getItem('accessToken')) return;
    void fetchCounts();
    const t = window.setInterval(() => void fetchCounts(), pollMs);
    const onRefresh = () => void fetchCounts();
    window.addEventListener(MY_OPEN_TICKETS_REFRESH_EVENT, onRefresh);
    const onVis = () => {
      if (document.visibilityState === 'visible') void fetchCounts();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(MY_OPEN_TICKETS_REFRESH_EVENT, onRefresh);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchCounts, pollMs]);

  return { ...counts, refetch: fetchCounts };
}
