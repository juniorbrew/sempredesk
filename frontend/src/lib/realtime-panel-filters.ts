import type { ChannelType } from '@/types/shared.types';

/** Conversa na fila de atendimento (lista / produtividade). */
export interface ConvRow {
  id: string;
  type?: string;
  contactName?: string;
  clientId?: string;
  ticketId?: string;
  ticketNumber?: string;
  channel?: string;
  status?: string;
  lastMessageAt?: string;
  lastAgentMessageAt?: string | null;
  createdAt?: string;
  /** Encerramento / última atualização (TypeORM); usado em MTTR e SLA de conversas fechadas. */
  updatedAt?: string;
  assignedTo?: string;
  assignedToName?: string;
  clientName?: string;
}

export interface ConvItem {
  convId: string;
  ticketId: string;
  ticketNumber: string;
  contactName: string;
  channel: string;
  lastMessageAt: string;
}

export interface AgentRow {
  userId: string;
  userName: string;
  userEmail: string;
  availability: 'online' | 'paused' | 'offline';
  pauseType: string | null;
  pauseSince: string | null;
  clockIn: string;
  activeTickets: number;
  activeConversations: number;
  finishedToday: number;
  activeConvList: ConvItem[];
}

export interface QueueItemRow {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  priority: string;
  origin: string;
  createdAt: string;
  conversationId: string | null;
  clientName: string;
  contactName: string;
  waitingMinutes: number;
}

export interface QueueStatsPayload {
  agents: AgentRow[];
  queue: QueueItemRow[];
  summary: { online: number; paused: number; total: number; queueLength: number };
}

export type RealtimePanelFilters = {
  operatorId: string;
  channel: 'all' | 'whatsapp' | 'portal';
  sla: 'all' | 'gt5' | 'gt10' | 'critical';
  stalled: 'all' | 'gt5' | 'gt10';
  clientSearch: string;
};

export function defaultRealtimeFilters(): RealtimePanelFilters {
  return {
    operatorId: '',
    channel: 'all',
    sla: 'all',
    stalled: 'all',
    clientSearch: '',
  };
}

export function minutesSince(iso: string | Date | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

export function formatSlaMinutes(m: number): string {
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}min`;
}

export function conversaSlaMinutes(c: ConvRow): number {
  return minutesSince(c.lastMessageAt || c.createdAt);
}

/**
 * SLA unificado para filtros e métricas de produtividade.
 * Ativas: minutos desde a última mensagem (igual ao painel).
 * Fechadas: minutos entre última mensagem e fecho/atualização (proxy de fila antes de encerrar).
 */
export function productivitySlaMinutes(c: ConvRow): number {
  if (c.status === 'closed') {
    const end = new Date(c.updatedAt || c.lastMessageAt || 0).getTime();
    const start = new Date(c.lastMessageAt || c.createdAt || 0).getTime();
    if (Number.isNaN(end) || Number.isNaN(start)) return 0;
    return Math.max(0, Math.floor((end - start) / 60000));
  }
  return conversaSlaMinutes(c);
}

export function minutesSinceLastAgentMessage(c: ConvRow): number {
  const la = c.lastAgentMessageAt;
  if (la != null && la !== '') {
    return minutesSince(la);
  }
  if (la === null) {
    return minutesSince(c.createdAt);
  }
  return minutesSince(c.lastMessageAt || c.createdAt);
}

export function toChannelType(ch?: string): ChannelType {
  return ch === 'whatsapp' ? 'whatsapp' : 'portal';
}

export function onlyDigits(s: string): string {
  return s.replace(/\D/g, '');
}

export function conversationClientMatch(c: ConvRow, raw: string): boolean {
  const q = raw.trim();
  if (!q) return true;
  const lower = q.toLowerCase();
  const parts = [
    c.clientName,
    c.contactName,
    c.ticketNumber,
    (c as { clientDocument?: string }).clientDocument,
    (c as { document?: string }).document,
    (c as { contactPhone?: string }).contactPhone,
    (c as { phone?: string }).phone,
    (c as { contactEmail?: string }).contactEmail,
    (c as { email?: string }).email,
  ]
    .filter(Boolean)
    .join(' ');
  const hay = parts.toLowerCase();
  if (hay.includes(lower)) return true;
  const dQ = onlyDigits(q);
  if (dQ.length >= 3) {
    const dHay = onlyDigits(parts);
    if (dHay.includes(dQ)) return true;
  }
  return false;
}

export function queueClientMatch(qRow: QueueItemRow, raw: string): boolean {
  const q = raw.trim();
  if (!q) return true;
  const lower = q.toLowerCase();
  const hay = [qRow.clientName, qRow.contactName, qRow.ticketNumber, qRow.subject].filter(Boolean).join(' ').toLowerCase();
  if (hay.includes(lower)) return true;
  const dQ = onlyDigits(q);
  if (dQ.length >= 3 && onlyDigits(hay).includes(dQ)) return true;
  return false;
}

export function queueChannelMatch(row: QueueItemRow, channel: 'whatsapp' | 'portal'): boolean {
  const o = (row.origin || '').toLowerCase();
  if (channel === 'whatsapp') return o.includes('whatsapp');
  return o.includes('portal') || o === 'portal' || o === 'web';
}

export function buildChartHistory(conversations: ConvRow[]): { label: string; value: number }[] {
  const buckets = 6;
  const now = Date.now();
  const counts = Array.from({ length: buckets }, () => 0);
  for (const c of conversations) {
    const t = new Date(c.lastMessageAt || c.createdAt || 0).getTime();
    if (Number.isNaN(t)) continue;
    const hoursAgo = Math.floor((now - t) / 3_600_000);
    if (hoursAgo >= 0 && hoursAgo < buckets) counts[buckets - 1 - hoursAgo] += 1;
  }
  return counts.map((value, i) => ({ label: `-${buckets - 1 - i}h`, value }));
}

export type ApplyFiltersInput = {
  conversations: ConvRow[];
  agents: AgentRow[];
  queue: QueueItemRow[];
};

export type ApplyFiltersOutput = {
  conversations: ConvRow[];
  agents: AgentRow[];
  queue: QueueItemRow[];
  chartHistory: { label: string; value: number }[];
  filteredSummary: { online: number; paused: number; total: number; queueLength: number };
};

export function applyFilters(filters: RealtimePanelFilters, data: ApplyFiltersInput): ApplyFiltersOutput {
  let convs = [...data.conversations];

  if (filters.operatorId) {
    convs = convs.filter((c) => c.assignedTo === filters.operatorId);
  }
  if (filters.channel !== 'all') {
    convs = convs.filter((c) => toChannelType(c.channel) === filters.channel);
  }
  if (filters.sla !== 'all') {
    convs = convs.filter((c) => {
      const m = conversaSlaMinutes(c);
      if (filters.sla === 'gt5') return m > 5;
      if (filters.sla === 'gt10' || filters.sla === 'critical') return m > 10;
      return true;
    });
  }
  if (filters.stalled !== 'all') {
    convs = convs.filter((c) => {
      const m = minutesSinceLastAgentMessage(c);
      if (filters.stalled === 'gt5') return m > 5;
      if (filters.stalled === 'gt10') return m > 10;
      return true;
    });
  }
  const qSearch = filters.clientSearch.trim();
  if (qSearch) {
    convs = convs.filter((c) => conversationClientMatch(c, qSearch));
  }

  let queue = [...data.queue];
  if (filters.operatorId) {
    queue = [];
  } else {
    if (filters.channel !== 'all') {
      const ch: 'whatsapp' | 'portal' = filters.channel;
      queue = queue.filter((r) => queueChannelMatch(r, ch));
    }
    if (qSearch) {
      queue = queue.filter((r) => queueClientMatch(r, qSearch));
    }
  }

  let agents = [...data.agents];
  if (filters.operatorId) {
    agents = agents.filter((a) => a.userId === filters.operatorId);
  }
  const hasConvNarrowing =
    filters.channel !== 'all' ||
    filters.sla !== 'all' ||
    filters.stalled !== 'all' ||
    qSearch.length > 0;
  if (hasConvNarrowing) {
    const assigned = new Set(
      convs.map((c) => c.assignedTo).filter((id): id is string => Boolean(id)),
    );
    agents = agents.filter((a) => assigned.has(a.userId));
  }

  const chartHistory = buildChartHistory(convs);
  const filteredSummary = {
    online: agents.filter((a) => a.availability === 'online').length,
    paused: agents.filter((a) => a.availability === 'paused').length,
    total: agents.length,
    queueLength: queue.length,
  };

  return {
    conversations: convs,
    agents,
    queue,
    chartHistory,
    filteredSummary,
  };
}

export type ApplyProductivityOutput = {
  conversations: ConvRow[];
  agents: AgentRow[];
};

/**
 * Filtros sobre conversas ativas + fechadas (produtividade).
 * SLA usa productivitySlaMinutes para incluir fechadas sem distorção temporal.
 * “Parado”: conversas fechadas ignoram o filtro (já encerradas).
 */
export function applyProductivityFilters(
  filters: RealtimePanelFilters,
  data: { conversations: ConvRow[]; agents: AgentRow[]; queue: QueueItemRow[] },
): ApplyProductivityOutput {
  let convs = [...data.conversations];

  if (filters.operatorId) {
    convs = convs.filter((c) => c.assignedTo === filters.operatorId);
  }
  if (filters.channel !== 'all') {
    convs = convs.filter((c) => toChannelType(c.channel) === filters.channel);
  }
  if (filters.sla !== 'all') {
    convs = convs.filter((c) => {
      const m = productivitySlaMinutes(c);
      if (filters.sla === 'gt5') return m > 5;
      if (filters.sla === 'gt10' || filters.sla === 'critical') return m > 10;
      return true;
    });
  }
  if (filters.stalled !== 'all') {
    convs = convs.filter((c) => {
      if (c.status === 'closed') return true;
      const m = minutesSinceLastAgentMessage(c);
      if (filters.stalled === 'gt5') return m > 5;
      if (filters.stalled === 'gt10') return m > 10;
      return true;
    });
  }
  const qSearch = filters.clientSearch.trim();
  if (qSearch) {
    convs = convs.filter((c) => conversationClientMatch(c, qSearch));
  }

  let agents = [...data.agents];
  if (filters.operatorId) {
    agents = agents.filter((a) => a.userId === filters.operatorId);
  }
  const hasConvNarrowing =
    filters.channel !== 'all' ||
    filters.sla !== 'all' ||
    filters.stalled !== 'all' ||
    qSearch.length > 0;
  if (hasConvNarrowing) {
    const assigned = new Set(
      convs.map((c) => c.assignedTo).filter((id): id is string => Boolean(id)),
    );
    agents = agents.filter((a) => assigned.has(a.userId));
  }

  return { conversations: convs, agents };
}

export function average(nums: number[]): number {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function clockSince(date: string | Date | null): string {
  if (!date) return '00:00:00';
  const diff = Date.now() - new Date(date).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function operatorAvgSlaFiltered(a: AgentRow, filteredConvIds: Set<string>): number | null {
  const list = (a.activeConvList || []).filter((ci) => filteredConvIds.has(ci.convId));
  if (!list.length) return null;
  return average(list.map((c) => minutesSince(c.lastMessageAt)));
}
