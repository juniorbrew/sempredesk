/** Evento disparado para abrir um ticket no painel lateral da página de atendimento (sem router para /dashboard/tickets). */
export const ATENDIMENTO_OPEN_TICKET_EVENT = 'sempredesk:atendimentoOpenTicket';

/** Query string na rota `/dashboard/atendimento` para abrir ticket no painel (funciona com navegação do App Router). */
export const ATENDIMENTO_OPEN_TICKET_QUERY = 'openTicket';

export function atendimentoUrlWithOpenTicket(ticketId: string): string {
  const id = encodeURIComponent(String(ticketId).trim());
  return `/dashboard/atendimento?${ATENDIMENTO_OPEN_TICKET_QUERY}=${id}`;
}

export type AtendimentoOpenTicketDetail = { ticketId: string };

/** Path real da página de atendimento (com sub-rotas como /realtime). */
export function isAtendimentoPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.split('?')[0];
  return /(^|\/)dashboard\/atendimento(\/|$)/.test(p);
}

export function dispatchOpenTicketInAtendimento(ticketId: string) {
  if (typeof window === 'undefined' || !ticketId) return;
  window.dispatchEvent(
    new CustomEvent(ATENDIMENTO_OPEN_TICKET_EVENT, {
      detail: { ticketId: String(ticketId).trim() } satisfies AtendimentoOpenTicketDetail,
    }),
  );
}

/** Extrai UUID do ticket de `/dashboard/tickets/:id` (ignora query). */
export function ticketIdFromTicketsHref(href: string): string | null {
  const m = href.trim().match(/^\/dashboard\/tickets\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
