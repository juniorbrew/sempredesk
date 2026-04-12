'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ATENDIMENTO_OPEN_TICKET_QUERY,
  atendimentoUrlWithOpenTicket,
} from '@/lib/atendimento-ticket-bridge';

/**
 * Sub-rotas (ex.: /dashboard/atendimento/realtime) não montam a página principal do inbox.
 * Se a URL tiver ?openTicket=, normaliza para /dashboard/atendimento?openTicket= onde o painel existe.
 */
export default function AtendimentoOpenTicketSubrouteRedirect() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const id = searchParams.get(ATENDIMENTO_OPEN_TICKET_QUERY)?.trim();
    if (!id) return;
    if (pathname === '/dashboard/atendimento') return;
    if (!pathname.startsWith('/dashboard/atendimento/')) return;
    router.replace(atendimentoUrlWithOpenTicket(id));
  }, [pathname, searchParams, router]);

  return null;
}
