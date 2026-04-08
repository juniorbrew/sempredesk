'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export const MY_OPEN_TICKETS_REFRESH_EVENT = 'sempredesk:my-open-tickets-refresh';

export function invalidateMyOpenTicketsCount() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MY_OPEN_TICKETS_REFRESH_EVENT));
  }
}

/**
 * Contador de chamados em aberto do agente autenticado (backend + tenant).
 * Atualização: montagem, intervalo, visibilidade da aba e evento global de invalidação.
 */
export function useMyOpenTicketsCount(pollMs = 60_000) {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const r: any = await api.getMyOpenAssignedTicketsCount();
      const n = typeof r?.count === 'number' ? r.count : Number(r?.data?.count);
      setCount(Number.isFinite(n) && n >= 0 ? n : 0);
    } catch {
      setCount(0);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !localStorage.getItem('accessToken')) return;
    void fetchCount();
    const t = window.setInterval(() => void fetchCount(), pollMs);
    const onRefresh = () => void fetchCount();
    window.addEventListener(MY_OPEN_TICKETS_REFRESH_EVENT, onRefresh);
    const onVis = () => {
      if (document.visibilityState === 'visible') void fetchCount();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(MY_OPEN_TICKETS_REFRESH_EVENT, onRefresh);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchCount, pollMs]);

  return { count, refetch: fetchCount };
}
