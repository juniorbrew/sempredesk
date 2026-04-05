'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import StatCard from '@/components/ui/StatCard';
import ChannelBadge from '@/components/ui/ChannelBadge';
import type { ChannelType } from '@/types/shared.types';
import {
  applyFilters,
  applyProductivityFilters,
  clockSince,
  conversaSlaMinutes,
  formatSlaMinutes,
  minutesSince,
  minutesSinceLastAgentMessage,
  operatorAvgSlaFiltered,
  average,
  toChannelType,
  type AgentRow,
  type QueueStatsPayload,
} from '@/lib/realtime-panel-filters';
import { computeOperatorProductivity } from '@/lib/realtime-productivity';
import { useRealtimePanelData } from '@/hooks/useRealtimePanelData';
import { useRealtimePanelFilters } from '@/hooks/useRealtimePanelFilters';
import { useTvMode } from '@/hooks/useTvMode';
import { RealtimeSubNav } from '@/components/realtime/RealtimeSubNav';
import { RealtimeFiltersPanel } from '@/components/realtime/RealtimeFiltersPanel';
import { ProductivityOverviewSection } from '@/components/realtime/ProductivityOverviewSection';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Monitor,
  RefreshCw,
  Send,
  Tv,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

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

export default function Page() {
  const { stats, convs, mergedForProductivity, team, loading, load, lastAt } = useRealtimePanelData();
  const [filters, setFilters] = useRealtimePanelFilters();
  const [tvMode, setTvMode] = useTvMode();

  const [transferTicketId, setTransferTicketId] = useState<string | null>(null);
  const [transferAgentId, setTransferAgentId] = useState('');
  const [transferring, setTransferring] = useState(false);

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

  const filteredProductivity = useMemo(
    () =>
      applyProductivityFilters(filters, {
        conversations: mergedForProductivity,
        agents: stats?.agents ?? [],
        queue: stats?.queue ?? [],
      }),
    [filters, mergedForProductivity, stats?.agents, stats?.queue],
  );

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of team) {
      if (u?.id) m.set(u.id, String(u.name || u.email || ''));
    }
    return m;
  }, [team]);

  const productivityRows = useMemo(
    () =>
      computeOperatorProductivity(
        filteredProductivity.conversations,
        filteredProductivity.agents,
        teamNameById,
      ),
    [filteredProductivity, teamNameById],
  );

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
    <div
      className={
        tvMode
          ? 'min-h-full w-full bg-slate-950 p-2 text-slate-100 md:p-4'
          : 'min-h-screen bg-slate-50 p-6 dark:bg-slate-950 md:p-8'
      }
    >
      {tvMode ? (
        <button
          type="button"
          onClick={() => setTvMode(false)}
          className="fixed right-3 top-3 z-[60] rounded-lg border border-white/20 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur-sm hover:bg-slate-800 md:right-4 md:top-4 md:px-4 md:py-2 md:text-sm"
        >
          Sair do modo TV
        </button>
      ) : null}

      <div className={tvMode ? 'mx-auto w-full max-w-none space-y-4 md:space-y-5' : 'mx-auto max-w-[1400px] space-y-6'}>
        {!tvMode ? (
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
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Link
                href="/dashboard/atendimento/realtime/tv"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Tv className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Modo TV
              </Link>
              <button
                type="button"
                onClick={() => setTvMode(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-800 shadow-sm hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200 dark:hover:bg-indigo-900/40"
              >
                <Monitor className="h-4 w-4" />
                Entrar no modo TV
              </button>
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
          </div>
        ) : (
          <div className="pr-28 pt-1 md:pr-36">
            <p className="text-sm font-semibold text-slate-300 md:text-base">
              Painel Real-Time · TV ·{' '}
              {lastAt
                ? lastAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '—'}
            </p>
          </div>
        )}

        <RealtimeSubNav tvMode={tvMode} />

        {loading && !stats ? (
          <div className="card flex flex-col items-center justify-center gap-3 p-16">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
            <p className="text-sm text-slate-500">A carregar indicadores…</p>
          </div>
        ) : (
          <>
            {/* Filtros avançados + gráfico (vista filtrada) — ocultos no modo TV (filtros em memória mantêm-se) */}
            {!tvMode ? (
              <RealtimeFiltersPanel filters={filters} setFilters={setFilters} sortedTeam={sortedTeam} />
            ) : null}

            {!tvMode ? (
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
            ) : null}

            {/* SEÇÃO 1 — INDICADORES */}
            <section id="sla-indicadores">
              <h2
                className={
                  tvMode
                    ? 'mb-4 text-sm font-bold uppercase tracking-wider text-slate-400 md:text-base'
                    : 'mb-3 text-xs font-bold uppercase tracking-wider text-slate-400'
                }
              >
                Indicadores
              </h2>
              <div
                className={
                  tvMode
                    ? 'grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6 xl:gap-8'
                    : 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'
                }
              >
                <div className={tvMode ? 'origin-top scale-105 md:scale-110' : ''}>
                  <StatCard
                    value={filtered.filteredSummary.online}
                    label="Operadores online"
                    icon={<Users className={tvMode ? 'h-8 w-8 md:h-10 md:w-10' : 'h-6 w-6'} />}
                  />
                </div>
                <div className={tvMode ? 'origin-top scale-105 md:scale-110' : ''}>
                  <StatCard
                    value={filtered.conversations.length}
                    label="Conversas ativas"
                    icon={<Activity className={tvMode ? 'h-8 w-8 md:h-10 md:w-10' : 'h-6 w-6'} />}
                  />
                </div>
                <div className={tvMode ? 'origin-top scale-105 md:scale-110' : ''}>
                  <StatCard
                    value={filtered.filteredSummary.queueLength}
                    label="Na fila"
                    icon={<AlertTriangle className={tvMode ? 'h-8 w-8 md:h-10 md:w-10' : 'h-6 w-6'} />}
                  />
                </div>
                <div className={tvMode ? 'origin-top scale-105 md:scale-110' : ''}>
                  <StatCard
                    value={formatSlaMinutes(globalSlaMinutes)}
                    label="SLA médio (última msg)"
                    trend={tvMode ? undefined : 'Tempo médio desde a última mensagem nas conversas ativas'}
                    trendDir="neutral"
                  />
                </div>
              </div>
            </section>

            {/* Alertas visuais avançados (somente leitura — dados já carregados) */}
            <section
              className={
                tvMode
                  ? 'rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-xl md:p-8'
                  : 'card p-5'
              }
            >
              <h2
                className={
                  tvMode
                    ? 'mb-4 text-lg font-bold text-slate-100 md:mb-6 md:text-2xl'
                    : 'mb-4 text-sm font-bold text-slate-900 dark:text-slate-100'
                }
              >
                Alertas em Tempo Real
              </h2>
              <div
                className={
                  tvMode
                    ? 'grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6 xl:gap-8'
                    : 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'
                }
              >
                <div
                  className={`rounded-xl border ${
                    tvMode ? 'px-4 py-5 md:px-6 md:py-8' : 'px-4 py-3'
                  } ${
                    realtimeAlertStats.critical > 0
                      ? tvMode
                        ? 'border-red-500/60 bg-red-950/50 shadow-lg shadow-red-900/30'
                        : 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30'
                      : tvMode
                        ? 'border-slate-600 bg-slate-800/60'
                        : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50'
                  }`}
                >
                  <p
                    className={
                      tvMode
                        ? 'text-sm font-bold text-red-300 md:text-base'
                        : 'text-xs font-semibold text-red-700 dark:text-red-300'
                    }
                  >
                    Conversas críticas (SLA)
                  </p>
                  <p
                    className={
                      tvMode
                        ? 'mt-2 text-4xl font-black tabular-nums text-red-100 md:mt-3 md:text-6xl'
                        : 'mt-1 text-2xl font-bold tabular-nums text-red-800 dark:text-red-200'
                    }
                  >
                    {realtimeAlertStats.critical}
                  </p>
                  {realtimeAlertStats.critical > 0 ? (
                    <span
                      className={
                        tvMode
                          ? 'mt-3 inline-flex rounded-full bg-red-600/40 px-3 py-1 text-sm font-bold text-red-100 md:text-base'
                          : 'mt-2 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/50 dark:text-red-200'
                      }
                    >
                      🔥 CRÍTICO
                    </span>
                  ) : null}
                </div>
                <div
                  className={`rounded-xl border ${
                    tvMode ? 'px-4 py-5 md:px-6 md:py-8' : 'px-4 py-3'
                  } ${
                    realtimeAlertStats.attention > 0
                      ? tvMode
                        ? 'border-orange-500/50 bg-orange-950/40'
                        : 'border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-950/30'
                      : tvMode
                        ? 'border-slate-600 bg-slate-800/60'
                        : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50'
                  }`}
                >
                  <p
                    className={
                      tvMode
                        ? 'text-sm font-bold text-orange-300 md:text-base'
                        : 'text-xs font-semibold text-orange-700 dark:text-orange-300'
                    }
                  >
                    Conversas em atenção (SLA)
                  </p>
                  <p
                    className={
                      tvMode
                        ? 'mt-2 text-4xl font-black tabular-nums text-orange-100 md:mt-3 md:text-6xl'
                        : 'mt-1 text-2xl font-bold tabular-nums text-orange-800 dark:text-orange-200'
                    }
                  >
                    {realtimeAlertStats.attention}
                  </p>
                  {realtimeAlertStats.attention > 0 ? (
                    <span
                      className={
                        tvMode
                          ? 'mt-3 inline-flex rounded-full bg-orange-600/35 px-3 py-1 text-sm font-bold text-orange-100 md:text-base'
                          : 'mt-2 inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700 dark:bg-orange-900/50 dark:text-orange-200'
                      }
                    >
                      ⚠️ Atenção
                    </span>
                  ) : null}
                </div>
                <div
                  className={`rounded-xl border ${
                    tvMode ? 'px-4 py-5 md:px-6 md:py-8' : 'px-4 py-3'
                  } ${
                    realtimeAlertStats.overloaded > 0
                      ? tvMode
                        ? 'border-red-500/60 bg-red-950/50'
                        : 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30'
                      : tvMode
                        ? 'border-slate-600 bg-slate-800/60'
                        : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50'
                  }`}
                >
                  <p
                    className={
                      tvMode
                        ? 'text-sm font-bold text-red-300 md:text-base'
                        : 'text-xs font-semibold text-red-700 dark:text-red-300'
                    }
                  >
                    Operadores sobrecarregados
                  </p>
                  <p
                    className={
                      tvMode
                        ? 'mt-2 text-4xl font-black tabular-nums text-red-100 md:mt-3 md:text-6xl'
                        : 'mt-1 text-2xl font-bold tabular-nums text-red-800 dark:text-red-200'
                    }
                  >
                    {realtimeAlertStats.overloaded}
                  </p>
                  {realtimeAlertStats.overloaded > 0 ? (
                    <span
                      className={
                        tvMode
                          ? 'mt-3 text-sm font-bold text-red-200 md:text-base'
                          : 'mt-2 inline-flex text-[10px] font-bold text-red-700 dark:text-red-300'
                      }
                    >
                      🔥 Sobrecarga (&gt;{OVERLOAD_THRESHOLD})
                    </span>
                  ) : null}
                </div>
                <div
                  className={`rounded-xl border ${
                    tvMode ? 'px-4 py-5 md:px-6 md:py-8' : 'px-4 py-3'
                  } ${
                    realtimeAlertStats.filaAlta
                      ? tvMode
                        ? 'border-orange-500/50 bg-orange-950/40'
                        : 'border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-950/30'
                      : tvMode
                        ? 'border-slate-600 bg-slate-800/60'
                        : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50'
                  }`}
                >
                  <p
                    className={
                      tvMode
                        ? 'text-sm font-bold text-orange-300 md:text-base'
                        : 'text-xs font-semibold text-orange-700 dark:text-orange-300'
                    }
                  >
                    Fila (tamanho atual)
                  </p>
                  <p
                    className={
                      tvMode
                        ? 'mt-2 text-4xl font-black tabular-nums text-orange-100 md:mt-3 md:text-6xl'
                        : 'mt-1 text-2xl font-bold tabular-nums text-orange-800 dark:text-orange-200'
                    }
                  >
                    {realtimeAlertStats.queueSize}
                  </p>
                  {realtimeAlertStats.filaAlta ? (
                    <span
                      className={
                        tvMode
                          ? 'mt-3 inline-flex rounded-full bg-orange-600/35 px-3 py-1 text-sm font-bold text-orange-100 md:text-base'
                          : 'mt-2 inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700 dark:bg-orange-900/50 dark:text-orange-200'
                      }
                    >
                      ⚠️ Alta demanda
                    </span>
                  ) : (
                    <p
                      className={
                        tvMode
                          ? 'mt-3 text-sm text-slate-400'
                          : 'mt-2 text-[10px] text-slate-500 dark:text-slate-400'
                      }
                    >
                      Alerta se &gt; {FILA_ALTA_MIN}
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* SEÇÃO 2 — OPERADORES */}
            <section
              id="secao-operadores"
              className={
                tvMode
                  ? 'rounded-2xl border border-slate-700 bg-slate-900/50 p-4 md:p-6'
                  : 'card p-5'
              }
            >
              <h2
                className={
                  tvMode
                    ? 'mb-4 text-lg font-bold text-slate-100 md:text-xl'
                    : 'mb-4 text-sm font-bold text-slate-900 dark:text-slate-100'
                }
              >
                Operadores
              </h2>
              {!stats?.agents.length ? (
                <p className="py-8 text-center text-sm text-slate-500">Nenhum registo de ponto aberto no momento.</p>
              ) : !filtered.agents.length ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  Nenhum operador corresponde aos filtros atuais.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    className={
                      tvMode
                        ? 'w-full min-w-[900px] border-collapse text-left text-base md:text-lg'
                        : 'w-full min-w-[900px] border-collapse text-left text-sm'
                    }
                  >
                    <thead>
                      <tr
                        className={
                          tvMode
                            ? 'border-b border-slate-600 text-sm font-bold uppercase tracking-wide text-slate-400'
                            : 'border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700'
                        }
                      >
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

            <ProductivityOverviewSection rows={productivityRows} tvMode={tvMode} />

            {/* SEÇÃO 3 — CONVERSAS ATIVAS */}
            <section
              className={
                tvMode
                  ? 'rounded-2xl border border-slate-700 bg-slate-900/50 p-4 md:p-6'
                  : 'card p-5'
              }
            >
              <h2
                className={
                  tvMode
                    ? 'mb-4 text-lg font-bold text-slate-100 md:text-xl'
                    : 'mb-4 text-sm font-bold text-slate-900 dark:text-slate-100'
                }
              >
                Conversas ativas
              </h2>
              {!activeConvs.length ? (
                <p className="py-8 text-center text-sm text-slate-500">Nenhuma conversa ativa.</p>
              ) : !filtered.conversations.length ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  Nenhuma conversa corresponde aos filtros atuais.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    className={
                      tvMode
                        ? 'w-full min-w-[960px] border-collapse text-left text-base md:text-lg'
                        : 'w-full min-w-[960px] border-collapse text-left text-sm'
                    }
                  >
                    <thead>
                      <tr
                        className={
                          tvMode
                            ? 'border-b border-slate-600 text-sm font-bold uppercase tracking-wide text-slate-400'
                            : 'border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700'
                        }
                      >
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
                          <tr
                            key={c.id}
                            className={`${conversaRowAlertClass(slaM, parada)} ${
                              tvMode && critico
                                ? 'shadow-[0_0_20px_rgba(248,113,113,0.55)] ring-2 ring-red-400/90 ring-offset-2 ring-offset-slate-950'
                                : ''
                            }`}
                          >
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
            <section
              className={
                tvMode
                  ? 'rounded-2xl border border-slate-700 bg-slate-900/50 p-4 md:p-6'
                  : 'card p-5'
              }
            >
              <h2
                className={
                  tvMode
                    ? 'mb-4 text-lg font-bold text-slate-100 md:text-xl'
                    : 'mb-4 text-sm font-bold text-slate-900 dark:text-slate-100'
                }
              >
                Fila (sem agente)
              </h2>
              {realtimeAlertStats.filaAlta ? (
                <p
                  className={
                    tvMode
                      ? 'mb-4 rounded-xl border border-orange-500/50 bg-orange-950/50 px-4 py-3 text-base font-semibold text-orange-200 md:text-lg'
                      : 'mb-4 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 dark:border-orange-900/40 dark:bg-orange-950/30 dark:text-orange-200'
                  }
                >
                  ⚠️ Alta demanda — {realtimeAlertStats.queueSize} ticket(s) na fila (limite visual &gt;{' '}
                  {FILA_ALTA_MIN})
                </p>
              ) : null}
              {!stats?.queue.length ? (
                <p
                  className={
                    tvMode
                      ? 'py-8 text-center text-lg text-slate-400 md:text-xl'
                      : 'py-8 text-center text-sm text-slate-500'
                  }
                >
                  Fila vazia.
                </p>
              ) : !filtered.queue.length ? (
                <p
                  className={
                    tvMode
                      ? 'py-8 text-center text-lg text-slate-400 md:text-xl'
                      : 'py-8 text-center text-sm text-slate-500'
                  }
                >
                  Nenhum ticket na fila corresponde aos filtros atuais.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    className={
                      tvMode
                        ? 'w-full min-w-[800px] border-collapse text-left text-base md:text-lg'
                        : 'w-full min-w-[800px] border-collapse text-left text-sm'
                    }
                  >
                    <thead>
                      <tr
                        className={
                          tvMode
                            ? 'border-b border-slate-600 text-sm font-bold uppercase tracking-wide text-slate-400'
                            : 'border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700'
                        }
                      >
                        <th className="pb-3 pr-4">Ticket</th>
                        <th className="pb-3 pr-4">Cliente / contato</th>
                        <th className="pb-3 pr-4">Espera</th>
                        {!tvMode ? <th className="pb-3">Ação</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.queue.map((q) => (
                        <tr
                          key={q.ticketId}
                          className={
                            tvMode
                              ? 'border-b border-slate-700/80'
                              : 'border-b border-slate-100 dark:border-slate-800/80'
                          }
                        >
                          <td
                            className={
                              tvMode
                                ? 'py-3 pr-4 font-mono font-bold text-indigo-300'
                                : 'py-3 pr-4 font-mono font-bold text-indigo-600 dark:text-indigo-400'
                            }
                          >
                            {q.ticketNumber}
                          </td>
                          <td className="py-3 pr-4">
                            <div
                              className={
                                tvMode
                                  ? 'font-medium text-slate-100'
                                  : 'font-medium text-slate-900 dark:text-slate-100'
                              }
                            >
                              {q.clientName}
                            </div>
                            {q.contactName ? (
                              <div className={tvMode ? 'text-sm text-slate-400' : 'text-xs text-slate-500'}>
                                {q.contactName}
                              </div>
                            ) : null}
                          </td>
                          <td
                            className={
                              tvMode
                                ? 'py-3 pr-4 text-slate-200'
                                : 'py-3 pr-4 text-slate-700 dark:text-slate-300'
                            }
                          >
                            {q.waitingMinutes < 1
                              ? 'agora'
                              : q.waitingMinutes < 60
                                ? `${q.waitingMinutes} min`
                                : `${Math.floor(q.waitingMinutes / 60)}h ${q.waitingMinutes % 60}min`}
                          </td>
                          {!tvMode ? (
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
                          ) : null}
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
