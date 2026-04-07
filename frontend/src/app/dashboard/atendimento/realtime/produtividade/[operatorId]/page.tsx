'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';
import { ArrowLeft, Loader2, Monitor, RefreshCw } from 'lucide-react';
import { useRealtimePanelData } from '@/hooks/useRealtimePanelData';
import { useRealtimePanelFilters } from '@/hooks/useRealtimePanelFilters';
import { useTvMode } from '@/hooks/useTvMode';
import {
  applyProductivityFilters,
  clockSince,
  productivitySlaMinutes,
  toChannelType,
} from '@/lib/realtime-panel-filters';
import {
  buildSyntheticAgentRowForProductivity,
  computeOperatorCharts,
  computeOperatorProductivity,
  mttrMinutesForConversation,
  mrtMinutesForConversation,
} from '@/lib/realtime-productivity';
import { RealtimeSubNav } from '@/components/realtime/RealtimeSubNav';
import { RealtimeFiltersPanel } from '@/components/realtime/RealtimeFiltersPanel';
import ChannelBadge from '@/components/ui/ChannelBadge';

function formatMin(m: number | null): string {
  if (m == null) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}min`;
}

export default function OperadorProdutividadePage() {
  const params = useParams();
  const operatorId = String(params?.operatorId ?? '');

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

  /** Nesta rota o filtro "Operador" não deve esconder o utilizador da URL. */
  const filtersSemOperador = useMemo(
    () => ({ ...filters, operatorId: '' as const }),
    [filters],
  );

  const filteredProductivity = useMemo(
    () =>
      applyProductivityFilters(filtersSemOperador, {
        conversations: mergedForProductivity,
        agents: stats?.agents ?? [],
        queue: stats?.queue ?? [],
      }),
    [filtersSemOperador, mergedForProductivity, stats?.agents, stats?.queue],
  );

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of team) {
      if (u?.id) m.set(u.id, String(u.name || u.email || ''));
    }
    return m;
  }, [team]);

  const agentRow = stats?.agents.find((a) => a.userId === operatorId);
  const teamMember = useMemo(
    () => team.find((u: { id?: string }) => u?.id === operatorId) as { name?: string; email?: string } | undefined,
    [team, operatorId],
  );

  const convsDoOperador = useMemo(
    () => filteredProductivity.conversations.filter((c) => c.assignedTo === operatorId),
    [filteredProductivity.conversations, operatorId],
  );

  const nomeAtribuidoNasConversas = useMemo(() => {
    const c = convsDoOperador.find((x) => x.assignedToName?.trim());
    return c?.assignedToName?.trim() ?? '';
  }, [convsDoOperador]);

  const agentRowForMetrics = useMemo(() => {
    if (agentRow) return agentRow;
    if (teamMember || convsDoOperador.length > 0) {
      return buildSyntheticAgentRowForProductivity(
        operatorId,
        teamMember ?? null,
        nomeAtribuidoNasConversas || undefined,
      );
    }
    return null;
  }, [agentRow, teamMember, convsDoOperador.length, operatorId, nomeAtribuidoNasConversas]);

  const productivityOne = useMemo(() => {
    if (!agentRowForMetrics) return null;
    const rows = computeOperatorProductivity(convsDoOperador, [agentRowForMetrics], teamNameById);
    return rows[0] ?? null;
  }, [agentRowForMetrics, convsDoOperador, teamNameById]);

  const chartSeries = useMemo(
    () => computeOperatorCharts(filteredProductivity.conversations, operatorId),
    [filteredProductivity.conversations, operatorId],
  );

  const lineData = useMemo(
    () =>
      chartSeries.map((p) => ({
        hora: p.hora,
        conversas: p.conversas,
        slaPct: p.slaPct ?? 0,
        mrt: p.mrtAvg ?? 0,
        mttr: p.mttrAvg ?? 0,
      })),
    [chartSeries],
  );

  const ativasLista = useMemo(
    () => convsDoOperador.filter((c) => c.status !== 'closed'),
    [convsDoOperador],
  );
  const resolvidasLista = useMemo(
    () => convsDoOperador.filter((c) => c.status === 'closed'),
    [convsDoOperador],
  );

  const displayName =
    productivityOne?.operatorName ||
    agentRow?.userName ||
    teamNameById.get(operatorId) ||
    nomeAtribuidoNasConversas ||
    'Operador';

  const chartH = tvMode ? 320 : 260;

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
                href="/dashboard/atendimento/realtime/produtividade"
                className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar à produtividade
              </Link>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 md:text-2xl">
                {displayName}
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Painel individual · Filtros aplicados (exceto &quot;Operador&quot;, que segue este URL) ·{' '}
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
            <p className="truncate text-sm font-semibold text-slate-300 md:text-base">
              {displayName} · TV ·{' '}
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
        ) : !agentRowForMetrics ? (
          <div className="card p-8 text-center text-slate-600 dark:text-slate-400">
            <p className="font-semibold">Utilizador desconhecido ou sem dados neste conjunto.</p>
            <p className="mt-2 text-sm">
              O ID não corresponde a ninguém na equipa e não há conversas atribuídas com os filtros atuais.
            </p>
            <Link href="/dashboard/atendimento/realtime/produtividade" className="mt-4 inline-block text-indigo-600">
              ← Produtividade
            </Link>
          </div>
        ) : (
          <>
            {!tvMode ? (
              <RealtimeFiltersPanel filters={filters} setFilters={setFilters} sortedTeam={sortedTeam} />
            ) : null}

            {!agentRow && agentRowForMetrics ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                Sem registo de ponto na fila neste momento — métricas vêm só das conversas (e da equipa).
              </p>
            ) : null}

            {productivityOne ? (
              <section
                className={
                  tvMode
                    ? 'grid grid-cols-2 gap-4 rounded-2xl border border-slate-700 bg-slate-900/50 p-4 md:grid-cols-4 md:gap-6 md:p-6'
                    : 'grid grid-cols-2 gap-3 sm:grid-cols-4'
                }
              >
                {[
                  ['Atendidas', String(productivityOne.atendidas)],
                  ['Resolvidas', String(productivityOne.resolvidas)],
                  ['MRT méd.', formatMin(productivityOne.mrtMinutesAvg)],
                  ['MTTR méd.', formatMin(productivityOne.mttrMinutesAvg)],
                  ['SLA ≤10m', `${productivityOne.slaIndividualPct}%`],
                  ['Críticas', String(productivityOne.criticas)],
                  [
                    'Tempo logado',
                    agentRow?.clockIn ? clockSince(agentRow.clockIn) : '—',
                  ],
                  ['E-mail', productivityOne.operatorEmail],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className={
                      tvMode
                        ? 'rounded-xl border border-slate-600 bg-slate-800/40 px-4 py-3'
                        : 'rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40'
                    }
                  >
                    <p className={tvMode ? 'text-sm text-slate-400' : 'text-xs text-slate-500'}>{k}</p>
                    <p className={tvMode ? 'text-xl font-bold tabular-nums md:text-2xl' : 'text-sm font-bold'}>{v}</p>
                  </div>
                ))}
              </section>
            ) : null}

            <section
              className={
                tvMode
                  ? 'rounded-2xl border border-slate-700 bg-slate-900/50 p-4 md:p-6'
                  : 'card p-5'
              }
            >
              <h2 className={tvMode ? 'mb-4 text-lg font-bold md:text-xl' : 'mb-3 text-sm font-bold'}>
                Conversas por hora (hoje)
              </h2>
              <div style={{ width: '100%', height: chartH }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={lineData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
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
                    <Bar dataKey="conversas" fill="#6366f1" radius={[4, 4, 0, 0]} name="Conversas" />
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
              <h2 className={tvMode ? 'mb-4 text-lg font-bold md:text-xl' : 'mb-3 text-sm font-bold'}>
                SLA, MRT e MTTR por hora (hoje)
              </h2>
              <div style={{ width: '100%', height: tvMode ? 340 : 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lineData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
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
                    <Line
                      type="monotone"
                      dataKey="slaPct"
                      name="SLA ok %"
                      stroke="#22c55e"
                      strokeWidth={tvMode ? 3 : 2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="mrt"
                      name="MRT méd (min)"
                      stroke="#f97316"
                      strokeWidth={tvMode ? 3 : 2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="mttr"
                      name="MTTR méd (min)"
                      stroke="#a855f7"
                      strokeWidth={tvMode ? 3 : 2}
                      dot={false}
                    />
                  </LineChart>
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
              <h2 className={tvMode ? 'mb-4 text-lg font-bold md:text-xl' : 'mb-3 text-sm font-bold'}>
                Conversas atendidas (ativas)
              </h2>
              <div className="overflow-x-auto">
                <table
                  className={
                    tvMode
                      ? 'w-full min-w-[720px] text-left text-base md:text-lg'
                      : 'w-full min-w-[720px] text-left text-sm'
                  }
                >
                  <thead>
                    <tr className={tvMode ? 'border-b border-slate-600 text-slate-400' : 'border-b dark:border-slate-700'}>
                      <th className="pb-2 pr-3">Contato</th>
                      <th className="pb-2 pr-3">Canal</th>
                      <th className="pb-2 pr-3">Ticket</th>
                      <th className="pb-2 pr-3">SLA (min)</th>
                      <th className="pb-2">MRT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ativasLista.map((c) => (
                      <tr key={c.id} className={tvMode ? 'border-b border-slate-700' : 'border-b dark:border-slate-800'}>
                        <td className="py-2 pr-3">{c.contactName || '—'}</td>
                        <td className="py-2 pr-3">
                          <ChannelBadge channel={toChannelType(c.channel)} size="sm" />
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">{c.ticketNumber || '—'}</td>
                        <td className="py-2 pr-3 tabular-nums">{productivitySlaMinutes(c)}</td>
                        <td className="py-2 tabular-nums">{formatMin(mrtMinutesForConversation(c))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!ativasLista.length ? (
                  <p className="py-6 text-center text-slate-500">Nenhuma conversa ativa atribuída neste filtro.</p>
                ) : null}
              </div>
            </section>

            <section
              className={
                tvMode
                  ? 'rounded-2xl border border-slate-700 bg-slate-900/50 p-4 md:p-6'
                  : 'card p-5'
              }
            >
              <h2 className={tvMode ? 'mb-4 text-lg font-bold md:text-xl' : 'mb-3 text-sm font-bold'}>
                Conversas resolvidas (fechadas)
              </h2>
              <div className="overflow-x-auto">
                <table
                  className={
                    tvMode
                      ? 'w-full min-w-[800px] text-left text-base md:text-lg'
                      : 'w-full min-w-[800px] text-left text-sm'
                  }
                >
                  <thead>
                    <tr className={tvMode ? 'border-b border-slate-600 text-slate-400' : 'border-b dark:border-slate-700'}>
                      <th className="pb-2 pr-3">Contato</th>
                      <th className="pb-2 pr-3">Canal</th>
                      <th className="pb-2 pr-3">Ticket</th>
                      <th className="pb-2 pr-3">MTTR</th>
                      <th className="pb-2">SLA último intervalo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolvidasLista.map((c) => (
                      <tr key={c.id} className={tvMode ? 'border-b border-slate-700' : 'border-b dark:border-slate-800'}>
                        <td className="py-2 pr-3">{c.contactName || '—'}</td>
                        <td className="py-2 pr-3">
                          <ChannelBadge channel={toChannelType(c.channel)} size="sm" />
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">{c.ticketNumber || '—'}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatMin(mttrMinutesForConversation(c))}</td>
                        <td className="py-2 tabular-nums">{productivitySlaMinutes(c)} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!resolvidasLista.length ? (
                  <p className="py-6 text-center text-slate-500">Nenhuma conversa fechada neste filtro.</p>
                ) : null}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
