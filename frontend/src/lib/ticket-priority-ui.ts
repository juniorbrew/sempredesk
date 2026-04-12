import type { CSSProperties } from 'react';
import {
  DEFAULT_PRIORITY,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  type SystemPriority,
} from '@/lib/priorities';

export type TicketPriorityInfo = {
  id?: string;
  name: string;
  color: string;
  slug: string;
  /** false quando a prioridade foi desativada no cadastro mas ainda ligada ao ticket/conversa. */
  active?: boolean;
};

/** Fundo suave a partir de cor hex (#RRGGBB). */
function softBgFromHex(hex: string): string {
  const h = hex.trim().replace(/^#/, '');
  if (h.length === 6) return `#${h}22`;
  if (h.length === 3) return `#${h.split('').map((c) => c + c).join('')}22`;
  return '#F1F5F922';
}

export function getTicketPriorityDisplay(ticket: {
  priority?: string | null;
  priorityInfo?: TicketPriorityInfo | null;
}): { label: string; bg: string; color: string; slug?: string; inactive?: boolean } {
  const pi = ticket?.priorityInfo;
  if (pi?.name) {
    const color = (pi.color || '#64748B').startsWith('#') ? pi.color : `#${pi.color}`;
    const inactive = pi.active === false;
    return {
      label: inactive ? `${pi.name} (inativa)` : pi.name,
      color,
      bg: softBgFromHex(color),
      slug: pi.slug,
      inactive,
    };
  }
  const slug = (ticket?.priority || DEFAULT_PRIORITY).toLowerCase();
  const st = PRIORITY_COLORS[slug as SystemPriority] || { bg: '#F1F5F9', color: '#64748B' };
  return {
    label: PRIORITY_LABELS[slug as SystemPriority] || slug,
    bg: st.bg,
    color: st.color,
    slug,
    inactive: false,
  };
}

export function isTicketCriticalUrgent(ticket: {
  priority?: string | null;
  priorityInfo?: TicketPriorityInfo | null;
}): boolean {
  return (
    ticket?.priority === 'critical' ||
    String(ticket?.priorityInfo?.slug || '').toLowerCase() === 'critical'
  );
}

export function ticketPriorityChipStyle(ticket: {
  priority?: string | null;
  priorityInfo?: TicketPriorityInfo | null;
}): CSSProperties {
  const d = getTicketPriorityDisplay(ticket);
  return {
    background: d.bg,
    color: d.color,
    padding: '2px 8px',
    borderRadius: 20,
    fontSize: 10,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    ...(d.inactive
      ? { border: '1px dashed rgba(100, 116, 139, 0.75)', boxSizing: 'border-box' as const }
      : {}),
  };
}
