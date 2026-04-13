'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { MY_OPEN_TICKETS_REFRESH_EVENT } from './useMyOpenTicketsCount';

type AtendimentoMenuItem = {
  key: string;
  label: string;
  ticketNumber: string | null;
};

type TicketMenuCounts = {
  atendimentoCount: number;
  atendimentoKeys: string[];
  atendimentoItems: AtendimentoMenuItem[];
  ticketsCount: number;
};

/**
 * Contadores operacionais do menu lateral.
 * - Atendimento: chats/conversas ativas do inbox do agente
 * - Tickets: tickets em aberto atribuídos ao agente
 */
export function useMyTicketMenuCounts(pollMs = 10_000) {
  const user = useAuthStore((s) => s.user);
  const [counts, setCounts] = useState<TicketMenuCounts>({
    atendimentoCount: 0,
    atendimentoKeys: [],
    atendimentoItems: [],
    ticketsCount: 0,
  });

  const fetchCounts = useCallback(async () => {
    if (!user?.id) {
      setCounts({
        atendimentoCount: 0,
        atendimentoKeys: [],
        atendimentoItems: [],
        ticketsCount: 0,
      });
      return;
    }

    try {
      const [convRes, openAssignedRes] = await Promise.allSettled([
        api.getConversations({ status: 'active', hasTicket: 'all' }),
        api.getMyOpenAssignedTicketsCount(),
      ]);

      const convPayload = convRes.status === 'fulfilled' ? convRes.value : null;
      const convArr = (Array.isArray(convPayload) ? convPayload : (convPayload as any)?.data ?? [])
        .filter((c: any) => c?.channel !== 'portal');

      const sorted = [...convArr].sort(
        (a: any, b: any) =>
          new Date(b?.lastMessageAt || b?.createdAt || 0).getTime() -
          new Date(a?.lastMessageAt || a?.createdAt || 0).getTime(),
      );

      const seenContacts = new Set<string>();
      const merged = sorted.filter((item: any) => {
        if (!item?.contactId) return true;
        const contactId = String(item.contactId);
        if (seenContacts.has(contactId)) return false;
        seenContacts.add(contactId);
        return true;
      });

      const atendimentoItems = merged
        .map((item: any) => ({
          key: String(item?.id || ''),
          label:
            String(
              item?.clientName ||
              item?.contactName ||
              item?.lastMessage ||
              'Novo chamado',
            ).trim() || 'Novo chamado',
          ticketNumber: item?.ticketNumber ? String(item.ticketNumber) : null,
        }))
        .filter((item) => item.key.length > 0);

      const atendimentoKeys = atendimentoItems.map((item) => item.key);

      const openAssignedPayload = openAssignedRes.status === 'fulfilled' ? openAssignedRes.value : null;
      const openAssignedRaw =
        typeof (openAssignedPayload as any)?.count === 'number'
          ? (openAssignedPayload as any).count
          : Number((openAssignedPayload as any)?.data?.count);

      setCounts({
        atendimentoCount: atendimentoKeys.length,
        atendimentoKeys,
        atendimentoItems,
        ticketsCount: Number.isFinite(openAssignedRaw) && openAssignedRaw >= 0 ? openAssignedRaw : 0,
      });
    } catch {
      setCounts({
        atendimentoCount: 0,
        atendimentoKeys: [],
        atendimentoItems: [],
        ticketsCount: 0,
      });
    }
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined' || !localStorage.getItem('accessToken')) return;
    void fetchCounts();
    const timer = window.setInterval(() => void fetchCounts(), pollMs);
    const onRefresh = () => void fetchCounts();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchCounts();
    };

    window.addEventListener(MY_OPEN_TICKETS_REFRESH_EVENT, onRefresh);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(MY_OPEN_TICKETS_REFRESH_EVENT, onRefresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchCounts, pollMs]);

  return { ...counts, refetch: fetchCounts };
}
