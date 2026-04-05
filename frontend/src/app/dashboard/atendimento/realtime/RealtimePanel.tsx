'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { usePresenceStore } from '@/store/presence.store';
import StatCard from '@/components/ui/StatCard';
import ChannelBadge from '@/components/ui/ChannelBadge';
import type { ChannelType } from '@/types/shared.types';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  RefreshCw,
  Send,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Tipos (espelham respostas já usadas no Supervisor) ───────────────────────
interface ConvItem {
  convId: string;
  ticketId: string;
  ticketNumber: string;
  contactName: string;
  channel: string;
  lastMessageAt: string;
}
interface AgentRow {
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
interface QueueItemRow {
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
interface QueueStatsPayload {
  agents: AgentRow[];
  queue: QueueItemRow[];
  summary: { online: number; paused: number; total: number; queueLength: number };
}
interface ConvRow {
  id: string;
  type?: string;
  contactName?: string;
  clientId?: string;
  ticketId?: string;
  ticketNumber?: string;
  channel?: string;
  status?: string;
  lastMessageAt?: string;
  /** Data ISO da última mensagem do agente (`user`). `null` = sem mensagem de agente ainda. */
  lastAgentMessageAt?: string | null;
  createdAt?: string;
  assignedTo?: string;
  assignedToName?: string;
  clientName?: string;
}

// ── SLA no frontend: tempo desde última mensagem (proxy de resposta) ─────────
function minutesSince(iso: string | Date | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

function formatSlaMinutes(m: number): string {
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}min`;
}

/** Minutos desde a última mensagem do agente; API antiga (campo ausente) mantém proxy por última atividade. */
function minutesSinceLastAgentMessage(c: ConvRow): number {
  const la = c.lastAgentMessageAt;
  if (la != null && la !== '') {
    return minutesSince(la);
  }
  if (la === null) {
    return minutesSince(c.createdAt);
  }
  return minutesSince(c.lastMessageAt || c.createdAt);
}

function average(nums: number[]): number {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function clockSince(date: string | Date | null): string {
  if (!date) return '00:00:00';
  const diff = Date.now() - new Date(date).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function toChannelType(ch?: string): ChannelType {
  return ch === 'whatsapp' ? 'whatsapp' : 'portal';
}

function statusLabel(a: AgentRow): string {
  if (a.availability === 'online') return 'Online';
  if (a.availability === 'paused') return 'Em pausa';
  return 'Offline';
}

function statusBadgeClass(a: AgentRow): string {
  if (a.availability === 'online') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200';
  if (a.availability === 'paused') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

const OVERLOAD_THRESHOLD = 5;
const SLA_ALERT_MINUTES = 5;

/** Alertas visuais avançados (apenas frontend) */
const SLA_CRITICO_MIN = 10;
const SLA_ATENCAO_MIN = SLA_ALERT_MINUTES;
const CONVERSA_PARADA_MIN = 8;
const FILA_ALTA_MIN = 10;

function conversaRowAlertClass(slaM: number, parada: boolean): string {
  const base = 'border-b border-slate-100 dark:border-slate-800/80';
  if (slaM > SLA_CRITICO_MIN) {
    return `${base} bg-red-50 animate-[pulse_3s_ease-in-out_infinite] dark:bg-red-950/25`;
  }
  if (parada) {
    return `${base} bg-red-50 dark:bg-red-950/25`;
  }
  if (slaM > SLA_ATENCAO_MIN) {
    return `${base} bg-orange-50 dark:bg-orange-950/25`;
  }
  return base;
}

/** Estado local dos filtros avançados (somente esta página). */
type RealtimePanelFilters = {
  operatorId: string;
  channel: 'all' | 'whatsapp' | 'portal';
  sla: 'all' | 'gt5' | 'gt10' | 'critical';
  stalled: 'all' | 'gt5' | 'gt10';
  clientSearch: string;
};

function defaultRealtimeFilters(): RealtimePanelFilters {
  return {
    operatorId: '',
    channel: 'all',
    sla: 'all',
    stalled: 'all',
    clientSearch: '',
  };
}

function conversaSlaMinutes(c: ConvRow): number {
  return minutesSince(c.lastMessageAt || c.createdAt);
}

function onlyDigits(s: string): string {
  return s.replace(/\D/g, '');
}

/** Busca em conversas: nome, telefone, email, CNPJ (campos opcionais vindos da API). */
function conversationClientMatch(c: ConvRow, raw: string): boolean {
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

function queueClientMatch(qRow: QueueItemRow, raw: string): boolean {
  const q = raw.trim();
  if (!q) return true;
  const lower = q.toLowerCase();
  const hay = [qRow.clientName, qRow.contactName, qRow.ticketNumber, qRow.subject].filter(Boolean).join(' ').toLowerCase();
  if (hay.includes(lower)) return true;
  const dQ = onlyDigits(q);
  if (dQ.length >= 3 && onlyDigits(hay).includes(dQ)) return true;
  return false;
}

function queueChannelMatch(row: QueueItemRow, channel: 'whatsapp' | 'portal'): boolean {
  const o = (row.origin || '').toLowerCase();
  if (channel === 'whatsapp') return o.includes('whatsapp');
  return o.includes('portal') || o === 'portal' || o === 'web';
}

/** Série simples para gráfico/histórico (últimas 6 horas, baseada em lastMessageAt). */
function buildChartHistory(conversations: ConvRow[]): { label: string; value: number }[] {
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

type ApplyFiltersInput = {
  conversations: ConvRow[];
  agents: AgentRow[];
  queue: QueueItemRow[];
};

type ApplyFiltersOutput = {
  conversations: ConvRow[];
  agents: AgentRow[];
  queue: QueueItemRow[];
  chartHistory: { label: string; value: number }[];
  /** Resumo derivado para cartões (online/pausa/total/fila) coerente com o filtro. */
  filteredSummary: { online: number; paused: number; total: number; queueLength: number };
};

/**
 * Aplica filtros locais a conversas, fila, operadores e dados para alertas/indicadores/gráfico.
 * Não altera APIs — apenas reduz vistas em memória.
 */
function applyFilters(filters: RealtimePanelFilters, data: ApplyFiltersInput): ApplyFiltersOutput {
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
      queue = queue.filter((r) => queueChannelMatch(r, filters.channel));
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

function operatorAvgSlaFiltered(a: AgentRow, filteredConvIds: Set<string>): number | null {
  const list = (a.activeConvList || []).filter((ci) => filteredConvIds.has(ci.convId));
  if (!list.length) return null;
  return average(list.map((c) => minutesSince(c.lastMessageAt)));
}

export default function RealtimePanel() {
  const [stats, setStats] = useState<QueueStatsPayload | null>(null);
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);
  const [lastAt, setLastAt] = useState<Date | null>(null);

  const [transferTicketId, setTransferTicketId] = useState<string | null>(null);
  const [transferAgentId, setTransferAgentId] = useState('');
  const [transferring, setTransferring] = useState(false);

  const [filters, setFilters] = useState<RealtimePanelFilters>(() => defaultRealtimeFilters());

  const onlineIds = usePresenceStore((s) => s.onlineIds);
  const prevPresenceSize = useRef(onlineIds.size);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [statsRes, convRes, teamRes] = await Promise.all([
        api.getAttendanceQueueStats(),
        api.getConversations({ status: 'active' }),
        api.getTeam(),
      ]);
      setStats(statsRes as QueueStatsPayload);
      const ca: ConvRow[] = Array.isArray(convRes) ? convRes : (convRes as any)?.data ?? [];
      setConvs(
        ca.sort(
          (a, b) =>
            new Date(b.lastMessageAt || b.createdAt || 0).getTime() -
            new Date(a.lastMessageAt || a.createdAt || 0).getTime(),
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

  const activeConvs = useMemo(() => convs.filter((c) => c.status !== 'closed'), [convs]);

  const filtered = useMemo(
    () =>
      applyFilters(filters, {
        conversations: activeConvs,
        agents: stats?.agents ?? [],
        queue: stats?.queue ?? [],
      }),
    [filters, activeConvs, stats?.agents, stats?.queue],
  );

  const filteredConvIds = useMemo(
    () => new Set(filtered.conversations.map((c) => c.id)),
    [filtered.conversations],
  );

  const sortedTeam = useMemo(() => {
    return [...team].sort((a, b) =>
      String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'pt', {
        sensitivity: 'base',
      }),
    );
  }, [team]);

  const globalSlaMinutes = useMemo(() => {
    const mins = filtered.conversations.map((c) => minutesSince(c.lastMessageAt || c.createdAt));
    return average(mins);
  }, [filtered.conversations]);

  const realtimeAlertStats = useMemo(() => {
    const critical = filtered.conversations.filter((c) => {
      const slaM = minutesSince(c.lastMessageAt || c.createdAt);
      return slaM > SLA_CRITICO_MIN;
    }).length;
    const attention = filtered.conversations.filter((c) => {
      const slaM = minutesSince(c.lastMessageAt || c.createdAt);
      return slaM > SLA_ATENCAO_MIN && slaM <= SLA_CRITICO_MIN;
    }).length;
    const overloaded = filtered.agents.filter((a) => {
      const n = filtered.conversations.filter((c) => c.assignedTo === a.userId).length;
      return n > OVERLOAD_THRESHOLD;
    }).length;
    const queueSize = filtered.filteredSummary.queueLength;
    const filaAlta = queueSize > FILA_ALTA_MIN;
    return { critical, attention, overloaded, filaAlta, queueSize };
  }, [filtered.agents, filtered.conversations, filtered.filteredSummary.queueLength]);

  const agentName = useCallback(
    (id?: string) => {
      const u = team.find((u: any) => u.id === id);
      return u ? u.name || u.email : null;
    },
    [team],
  );

  const confirmAssign = async () => {
    if (!transferTicketId || !transferAgentId) return;
    setTransferring(true);
    try {
      await api.assignTicket(transferTicketId, transferAgentId);
      toast.success('Ticket atribuído');
      setTransferTicketId(null);
      setTransferAgentId('');
      load(true);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao atribuir');
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-8">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              href="/dashboard/atendimento"
              className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar ao Atendimento
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 md:text-2xl">
              Painel real-time avançado
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Somente leitura + atribuição na fila · Atualizado{' '}
              {lastAt
                ? lastAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => load(false)}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        {loading && !stats ? (
          <div className="card flex flex-col items-center justify-center gap-3 p-16">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
            <p className="text-sm text-slate-500">A carregar indicadores…</p>
          </div>
        ) : (
          <>
            {/* Filtros avançados + gráfico (vista filtrada) */}
            <section className="card p-5">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Filtros
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Operador
                  <select
                    value={filters.operatorId}
                    onChange={(e) => setFilters((f) => ({ ...f, operatorId: e.target.value }))}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value="">Todos</option>
                    {sortedTeam.map((u: { id: string; name?: string; email?: string }) => (
                      <option key={u.id} value={u.id}>
                        {u.name || u.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Canal
                  <select
                    value={filters.channel}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        channel: e.target.value as RealtimePanelFilters['channel'],
                      }))
                    }
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value="all">Todos</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="portal">Portal</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  SLA
                  <select
                    value={filters.sla}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, sla: e.target.value as RealtimePanelFilters['sla'] }))
                    }
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value="all">Todos</option>
                    <option value="gt5">SLA &gt; 5 min</option>
                    <option value="gt10">SLA &gt; 10 min</option>
                    <option value="critical">Crítico</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Tempo parado
                  <select
                    value={filters.stalled}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        stalled: e.target.value as RealtimePanelFilters['stalled'],
                      }))
                    }
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value="all">Todos</option>
                    <option value="gt5">&gt; 5 min sem resposta</option>
                    <option value="gt10">&gt; 10 min sem resposta</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 md:col-span-2 xl:col-span-2">
                  Cliente
                  <input
                    type="search"
                    placeholder="Buscar cliente (nome, telefone, e-mail, CNPJ…)"
                    value={filters.clientSearch}
                    onChange={(e) => setFilters((f) => ({ ...f, clientSearch: e.target.value }))}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => setFilters(defaultRealtimeFilters())}
                className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Limpar filtros
              </button>
            </section>

            <section className="card p-5">
              <h2 className="mb-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                Histórico visual (filtrado)
              </h2>
              <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
                Conversas filtradas por hora da última mensagem (janela de 6 h).
              </p>
              {(() => {
                const maxV = Math.max(...filtered.chartHistory.map((x) => x.value), 1);
                return (
                  <div className="flex h-40 items-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                    {filtered.chartHistory.map((b) => {
                      const hPct = Math.round((b.value / maxV) * 100);
                      return (
                        <div key={b.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                          <div className="flex h-28 w-full items-end justify-center rounded-t-md bg-slate-100 dark:bg-slate-800/80">
                            <div
                              className="w-full max-w-[40px] rounded-t bg-indigo-500 dark:bg-indigo-600"
                              style={{ height: `${Math.max(hPct, 2)}%`, minHeight: b.value > 0 ? 4 : 0 }}
                              title={`${b.label}: ${b.value}`}
                            />
                          </div>
                          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            {b.label}
                          </span>
                          <span className="text-xs font-bold tabular-nums text-slate-800 dark:text-slate-200">
                            {b.value}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </section>

            {/* SEÇÃO 1 — INDICADORES */}
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Indicadores</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  value={filtered.filteredSummary.online}
                  label="Operadores online"
                  icon={<Users className="h-6 w-6" />}
                />
                <StatCard
                  value={filtered.conversations.length}
                  label="Conversas ativas"
                  icon={<Activity className="h-6 w-6" />}
                />
                <StatCard
                  value={filtered.filteredSummary.queueLength}
                  label="Na fila"
                  icon={<AlertTriangle className="h-6 w-6" />}
                />
                <StatCard
                  value={formatSlaMinutes(globalSlaMinutes)}
                  label="SLA médio (última msg)"
                  trend="Tempo médio desde a última mensagem nas conversas ativas"
                  trendDir="neutral"
                />
              </div>
            </section>

            {/* Alertas visuais avançados (somente leitura — dados já carregados) */}
            <section className="card p-5">
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-slate-100">Alertas em Tempo Real</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div
                  className={`rounded-xl border px-4 py-3 ${
                    realtimeAlertStats.critical > 0
                      ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50'
                  }`}
                >
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300">Conversas críticas (SLA)</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-red-800 dark:text-red-200">
                    {realtimeAlertStats.critical}
                  </p>
                  {realtimeAlertStats.critical > 0 ? (
                    <span className="mt-2 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/50 dark:text-red-200">
                      🔥 CRÍTICO
                    </span>
                  ) : null}
                </div>
                <div
                  className={`rounded-xl border px-4 py-3 ${
                    realtimeAlertStats.attention > 0
                      ? 'border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-950/30'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50'
                  }`}
                >
                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-300">Conversas em atenção (SLA)</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-orange-800 dark:text-orange-200">
                    {realtimeAlertStats.attention}
                  </p>
                  {realtimeAlertStats.attention > 0 ? (
                    <span className="mt-2 inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700 dark:bg-orange-900/50 dark:text-orange-200">
                      ⚠️ Atenção
                    </span>
                  ) : null}
                </div>
                <div
                  className={`rounded-xl border px-4 py-3 ${
                    realtimeAlertStats.overloaded > 0
                      ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50'
                  }`}
                >
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300">Operadores sobrecarregados</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-red-800 dark:text-red-200">
                    {realtimeAlertStats.overloaded}
                  </p>
                  {realtimeAlertStats.overloaded > 0 ? (
                    <span className="mt-2 inline-flex text-[10px] font-bold text-red-700 dark:text-red-300">
                      🔥 Sobrecarga (&gt;{OVERLOAD_THRESHOLD})
                    </span>
                  ) : null}
                </div>
                <div
                  className={`rounded-xl border px-4 py-3 ${
                    realtimeAlertStats.filaAlta
                      ? 'border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-950/30'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50'
                  }`}
                >
                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-300">Fila (tamanho atual)</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-orange-800 dark:text-orange-200">
                    {realtimeAlertStats.queueSize}
                  </p>
                  {realtimeAlertStats.filaAlta ? (
                    <span className="mt-2 inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700 dark:bg-orange-900/50 dark:text-orange-200">
                      ⚠️ Alta demanda
                    </span>
                  ) : (
                    <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">Alerta se &gt; {FILA_ALTA_MIN}</p>
                  )}
                </div>
              </div>
            </section>

            {/* SEÇÃO 2 — OPERADORES */}
            <section className="card p-5">
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-slate-100">Operadores</h2>
              {!stats?.agents.length ? (
                <p className="py-8 text-center text-sm text-slate-500">Nenhum registo de ponto aberto no momento.</p>
              ) : !filtered.agents.length ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  Nenhum operador corresponde aos filtros atuais.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700">
                        <th className="pb-3 pr-4">Nome</th>
                        <th className="pb-3 pr-4">Status</th>
                        <th className="pb-3 pr-4">Conversas ativas</th>
                        <th className="pb-3 pr-4">SLA médio</th>
                        <th className="pb-3 pr-4">Tempo logado</th>
                        <th className="pb-3">Alerta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.agents.map((a) => {
                        const nAssigned = filtered.conversations.filter((c) => c.assignedTo === a.userId).length;
                        const slaOp = operatorAvgSlaFiltered(a, filteredConvIds);
                        const overload = nAssigned > OVERLOAD_THRESHOLD;
                        return (
                          <tr
                            key={a.userId}
                            className="border-b border-slate-100 dark:border-slate-800/80"
                          >
                            <td className="py-3 pr-4">
                              <div className="font-semibold text-slate-900 dark:text-slate-100">{a.userName}</div>
                              <div className="text-xs text-slate-500">{a.userEmail}</div>
                            </td>
                            <td className="py-3 pr-4">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${statusBadgeClass(a)}`}
                              >
                                {statusLabel(a)}
                              </span>
                            </td>
                            <td
                              className={`py-3 pr-4 font-mono font-semibold ${
                                overload
                                  ? 'text-red-700 dark:text-red-400'
                                  : 'text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              {nAssigned}
                            </td>
                            <td className="py-3 pr-4 text-slate-700 dark:text-slate-300">
                              {slaOp === null ? '—' : formatSlaMinutes(slaOp)}
                            </td>
                            <td className="py-3 pr-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                              {clockSince(a.clockIn)}
                            </td>
                            <td className="py-3">
                              {overload ? (
                                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/40 dark:text-red-200">
                                  🔥 Sobrecarga
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* SEÇÃO 3 — CONVERSAS ATIVAS */}
            <section className="card p-5">
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-slate-100">Conversas ativas</h2>
              {!activeConvs.length ? (
                <p className="py-8 text-center text-sm text-slate-500">Nenhuma conversa ativa.</p>
              ) : !filtered.conversations.length ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  Nenhuma conversa corresponde aos filtros atuais.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700">
                        <th className="pb-3 pr-4">Contato</th>
                        <th className="pb-3 pr-4">Canal</th>
                        <th className="pb-3 pr-4">Agente</th>
                        <th className="pb-3 pr-4">Desde última msg</th>
                        <th className="pb-3 pr-4">SLA</th>
                        <th className="pb-3">Alerta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.conversations.map((c) => {
                        const last = c.lastMessageAt || c.createdAt;
                        const slaM = minutesSince(last);
                        const minAgent = minutesSinceLastAgentMessage(c);
                        const parada = minAgent > CONVERSA_PARADA_MIN;
                        const agent = c.assignedToName || agentName(c.assignedTo) || '—';
                        const critico = slaM > SLA_CRITICO_MIN;
                        const atencao = slaM > SLA_ATENCAO_MIN && slaM <= SLA_CRITICO_MIN;
                        const temAlerta = critico || atencao || parada;
                        return (
                          <tr key={c.id} className={conversaRowAlertClass(slaM, parada)}>
                            <td className="py-3 pr-4 font-medium text-slate-900 dark:text-slate-100">
                              {c.contactName || '—'}
                            </td>
                            <td className="py-3 pr-4">
                              <ChannelBadge channel={toChannelType(c.channel)} size="sm" />
                            </td>
                            <td className="py-3 pr-4 text-slate-700 dark:text-slate-300">{agent}</td>
                            <td className="py-3 pr-4 text-slate-600 dark:text-slate-400">
                              {formatSlaMinutes(slaM)}
                            </td>
                            <td
                              className={`py-3 pr-4 font-mono text-xs ${
                                critico
                                  ? 'text-red-700 dark:text-red-300'
                                  : atencao
                                    ? 'text-orange-700 dark:text-orange-300'
                                    : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {formatSlaMinutes(slaM)}
                            </td>
                            <td className="py-3">
                              {temAlerta ? (
                                <div className="flex flex-wrap gap-1">
                                  {critico ? (
                                    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 animate-[pulse_3s_ease-in-out_infinite] dark:bg-red-900/50 dark:text-red-200">
                                      🔥 CRÍTICO
                                    </span>
                                  ) : null}
                                  {atencao ? (
                                    <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700 dark:bg-orange-900/50 dark:text-orange-200">
                                      ⚠️ Atenção
                                    </span>
                                  ) : null}
                                  {parada ? (
                                    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/50 dark:text-red-200">
                                      🔥 Sem resposta
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">OK</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* SEÇÃO 4 — FILA */}
            <section className="card p-5">
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-slate-100">Fila (sem agente)</h2>
              {realtimeAlertStats.filaAlta ? (
                <p className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 dark:border-orange-900/40 dark:bg-orange-950/30 dark:text-orange-200">
                  ⚠️ Alta demanda — {realtimeAlertStats.queueSize} ticket(s) na fila (limite visual &gt;{' '}
                  {FILA_ALTA_MIN})
                </p>
              ) : null}
              {!stats?.queue.length ? (
                <p className="py-8 text-center text-sm text-slate-500">Fila vazia.</p>
              ) : !filtered.queue.length ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  Nenhum ticket na fila corresponde aos filtros atuais.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700">
                        <th className="pb-3 pr-4">Ticket</th>
                        <th className="pb-3 pr-4">Cliente / contato</th>
                        <th className="pb-3 pr-4">Espera</th>
                        <th className="pb-3">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.queue.map((q) => (
                        <tr
                          key={q.ticketId}
                          className="border-b border-slate-100 dark:border-slate-800/80"
                        >
                          <td className="py-3 pr-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {q.ticketNumber}
                          </td>
                          <td className="py-3 pr-4">
                            <div className="font-medium text-slate-900 dark:text-slate-100">{q.clientName}</div>
                            {q.contactName ? (
                              <div className="text-xs text-slate-500">{q.contactName}</div>
                            ) : null}
                          </td>
                          <td className="py-3 pr-4 text-slate-700 dark:text-slate-300">
                            {q.waitingMinutes < 1
                              ? 'agora'
                              : q.waitingMinutes < 60
                                ? `${q.waitingMinutes} min`
                                : `${Math.floor(q.waitingMinutes / 60)}h ${q.waitingMinutes % 60}min`}
                          </td>
                          <td className="py-3">
                            <button
                              type="button"
                              onClick={() => {
                                setTransferTicketId(q.ticketId);
                                setTransferAgentId('');
                              }}
                              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700"
                            >
                              <Send className="h-3.5 w-3.5" />
                              Atribuir
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Modal atribuir (usa assignTicket existente) */}
      {transferTicketId && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !transferring && setTransferTicketId(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900 dark:ring-1 dark:ring-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Atribuir ticket</h3>
                <p className="mt-0.5 text-xs text-slate-500">Selecione o agente destino</p>
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => !transferring && setTransferTicketId(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto px-3 py-2">
              {team
                .filter((u: any) => ['technician', 'admin', 'manager'].includes(u.role))
                .map((u: any) => {
                  const agentStat = stats?.agents.find((a) => a.userId === u.id);
                  const isOnline = agentStat?.availability === 'online';
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setTransferAgentId(u.id)}
                      className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        transferAgentId === u.id
                          ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/40'
                          : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/80'
                      }`}
                    >
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {u.name || u.email}
                        </p>
                        <p className="text-xs text-slate-500">
                          {isOnline ? `Online · ${agentStat?.activeTickets ?? 0} tickets` : 'Fora do painel / offline'}
                        </p>
                      </div>
                      {transferAgentId === u.id && <Check className="h-4 w-4 shrink-0 text-indigo-600" />}
                    </button>
                  );
                })}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300"
                onClick={() => !transferring && setTransferTicketId(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!transferAgentId || transferring}
                onClick={confirmAssign}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {transferring ? 'A atribuir…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
