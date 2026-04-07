'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts';
import { ArrowLeft, Loader2, Monitor, RefreshCw } from 'lucide-react';
import { useRealtimePanelData } from '@/hooks/useRealtimePanelData';
import { useRealtimePanelFilters } from '@/hooks/useRealtimePanelFilters';
import { useTvMode } from '@/hooks/useTvMode';
import { applyProductivityFilters, clockSince } from '@/lib/realtime-panel-filters';
import {
  computeComparativeConversationsByHour,
  computeOperatorProductivity,
  computeOperatorRanking,
} from '@/lib/realtime-productivity';
import { RealtimeSubNav } from '@/components/realtime/RealtimeSubNav';
import { RealtimeFiltersPanel } from '@/components/realtime/RealtimeFiltersPanel';

function formatMin(m: number | null): string {
  if (m == null) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}min`;
}

const CHART_COLORS = ['#6366f1', '#22c55e', '#f97316', '#ec4899', '#06b6d4'];

export default function ProdutividadePage() {
  const { stats, mergedForProductivity, team, loading, load, lastAt } = useRealtimePanelData();
  const [filters, setFilters] = useRealtimePanelFilters();
  const [tvMode, setTvMode] = useTvMode();

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

  const ranked = useMemo(() => computeOperatorRanking(productivityRows), [productivityRows]);

  const rankingChartData = useMemo(
    () =>
      ranked.slice(0, 12).map((r) => ({
        nome: r.operatorName.length > 14 ? `${r.operatorName.slice(0, 12)}…` : r.operatorName,
        Resolvidas: r.resolvidas,
        Atendidas: r.atendidas,
      })),
    [ranked],
  );

  const topIds = useMemo(() => {
    return [...productivityRows]
      .sort((a, b) => b.atendidas - a.atendidas)
      .slice(0, 5)
      .map((r) => r.operatorId);
  }, [productivityRows]);

  const comparativeData = useMemo(
    () => computeComparativeConversationsByHour(filteredProductivity.conversations, topIds),
    [filteredProductivity.conversations, topIds],
  );

  const chartH = tvMode ? 360 : 280;

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
                href="/dashboard/atendimento/realtime"
                className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar ao Real-Time
              </Link>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 md:text-2xl">
                Produtividade por operador
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Cálculos no browser · Atualizado{' '}
                {lastAt
                  ? lastAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : '—'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setTvMode(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-800 shadow-sm hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200 dark:hover:bg-indigo-900/40"
              >
                <Monitor className="h-4 w-4" />
                Modo TV
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
              Produtividade · TV ·{' '}
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
            <p className="text-sm text-slate-500">A carregar…</p>
          </div>
        ) : (
          <>
            {!tvMode ? (
              <RealtimeFiltersPanel filters={filters} setFilters={setFilters} sortedTeam={sortedTeam} />
            ) : null}

            <section
              className={
                tvMode
                  ? 'rounded-2xl border border-slate-700 bg-slate-900/50 p-4 md:p-6'
                  : 'card p-5'
              }
            >
              <h2 className={tvMode ? 'mb-4 text-lg font-bold text-slate-100 md:text-xl' : 'mb-4 text-sm font-bold'}>
                Ranking (resolvidas / atendidas)
              </h2>
              <div style={{ width: '100%', height: chartH }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rankingChartData} margin={{ top: 8, right: 8, left: 8, bottom: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-700" />
                    <XAxis dataKey="nome" tick={{ fill: tvMode ? '#94a3b8' : '#64748b', fontSize: tvMode ? 13 : 11 }} />
                    <YAxis tick={{ fill: tvMode ? '#94a3b8' : '#64748b', fontSize: tvMode ? 13 : 11 }} />
                    <Tooltip
                      contentStyle={
                        tvMode
                          ? { background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }
                          : undefined
                      }
                    />
                    <Legend />
                    <Bar dataKey="Resolvidas" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Atendidas" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section
              className={
                tvMode
                  ? 'rounded-2xl border border-slate-700 bg-slate-900/50 p-4 md:p-6'
                  : 'card p-5'
              }
            >
              <h2 className={tvMode ? 'mb-4 text-lg font-bold text-slate-100 md:text-xl' : 'mb-4 text-sm font-bold'}>
                Comparativo — conversas por hora (hoje, top {topIds.length} por volume)
              </h2>
              <div style={{ width: '100%', height: chartH }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={comparativeData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-700" />
                    <XAxis dataKey="hora" tick={{ fill: tvMode ? '#94a3b8' : '#64748b', fontSize: tvMode ? 12 : 10 }} />
                    <YAxis tick={{ fill: tvMode ? '#94a3b8' : '#64748b', fontSize: tvMode ? 12 : 10 }} />
                    <Tooltip
                      contentStyle={
                        tvMode
                          ? { background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }
                          : undefined
                      }
                    />
                    <Legend />
                    {topIds.map((id, i) => {
                      const name =
                        productivityRows.find((r) => r.operatorId === id)?.operatorName?.slice(0, 12) || id.slice(0, 8);
                      return (
                        <Line
                          key={id}
                          type="monotone"
                          dataKey={id}
                          name={name}
                          stroke={CHART_COLORS[i % CHART_COLORS.length]}
                          strokeWidth={tvMode ? 3 : 2}
                          dot={false}
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section
              className={
                tvMode
                  ? 'overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/50 p-4 md:p-6'
                  : 'card overflow-x-auto p-5'
              }
            >
              <h2 className={tvMode ? 'mb-4 text-lg font-bold text-slate-100 md:text-xl' : 'mb-4 text-sm font-bold'}>
                Tabela completa
              </h2>
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
                        ? 'border-b border-slate-600 text-slate-400'
                        : 'border-b border-slate-200 text-xs uppercase text-slate-400 dark:border-slate-700'
                    }
                  >
                    <th className="pb-3 pr-3">#</th>
                    <th className="pb-3 pr-3">Operador</th>
                    <th className="pb-3 pr-3">Atendidas</th>
                    <th className="pb-3 pr-3">Resolvidas</th>
                    <th className="pb-3 pr-3">MRT méd.</th>
                    <th className="pb-3 pr-3">MTTR méd.</th>
                    <th className="pb-3 pr-3">SLA ≤10m</th>
                    <th className="pb-3 pr-3">Críticas</th>
                    <th className="pb-3">Tempo logado</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r) => {
                    const agent = stats?.agents.find((a) => a.userId === r.operatorId);
                    return (
                      <tr
                        key={r.operatorId}
                        className={
                          tvMode ? 'border-b border-slate-700' : 'border-b border-slate-100 dark:border-slate-800'
                        }
                      >
                        <td className="py-2 pr-3 font-mono text-slate-500">{r.rank}</td>
                        <td className="py-2 pr-3">
                          <Link
                            href={`/dashboard/atendimento/realtime/produtividade/${r.operatorId}`}
                            className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            {r.operatorName}
                          </Link>
                          <div className={tvMode ? 'text-sm text-slate-400' : 'text-xs text-slate-500'}>
                            {r.operatorEmail}
                          </div>
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{r.atendidas}</td>
                        <td className="py-2 pr-3 tabular-nums">{r.resolvidas}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatMin(r.mrtMinutesAvg)}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatMin(r.mttrMinutesAvg)}</td>
                        <td className="py-2 pr-3 tabular-nums">{r.slaIndividualPct}%</td>
                        <td className="py-2 pr-3 tabular-nums text-red-600 dark:text-red-400">{r.criticas}</td>
                        <td className="py-2 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {agent ? clockSince(agent.clockIn) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!ranked.length ? (
                <p className="py-8 text-center text-slate-500">Nenhum dado no conjunto filtrado.</p>
              ) : null}
            </section>

            <p className={tvMode ? 'text-sm text-slate-500' : 'text-xs text-slate-500 dark:text-slate-400'}>
              SLA e críticas usam a mesma regra do painel (≤10 min ok). MRT usa proxy criado → última mensagem de
              agente na API. MTTR: criado → fecho (updatedAt) em conversas fechadas.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
