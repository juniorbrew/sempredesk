'use client';

import Link from 'next/link';
import clsx from 'clsx';
import type { OperatorProductivityRow } from '@/lib/realtime-productivity';

function formatMin(m: number | null): string {
  if (m == null) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}min`;
}

type Props = {
  rows: OperatorProductivityRow[];
  tvMode: boolean;
};

/**
 * Visão geral com barras horizontais simples (sem Recharts).
 */
export function ProductivityOverviewSection({ rows, tvMode }: Props) {
  const maxAtendidas = Math.max(1, ...rows.map((r) => r.atendidas));

  return (
    <section
      className={clsx(
        tvMode
          ? 'rounded-2xl border border-slate-700 bg-slate-900/50 p-4 md:p-6'
          : 'card p-5',
      )}
      id="secao-produtividade-visao-geral"
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            className={clsx(
              'font-bold text-slate-900 dark:text-slate-100',
              tvMode ? 'text-lg md:text-2xl' : 'text-sm',
            )}
          >
            Produtividade (visão geral)
          </h2>
          <p className={clsx('text-slate-500 dark:text-slate-400', tvMode ? 'text-sm md:text-base' : 'text-xs')}>
            Métricas por operador com base nas conversas já filtradas · apenas frontend
          </p>
        </div>
        {!tvMode ? (
          <Link
            href="/dashboard/atendimento/realtime/produtividade"
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            Abrir produtividade completa →
          </Link>
        ) : null}
      </div>

      {!rows.length ? (
        <p className={clsx('py-8 text-center text-slate-500', tvMode && 'text-lg')}>
          Nenhum operador no conjunto filtrado.
        </p>
      ) : (
        <div className={clsx('space-y-4', tvMode && 'space-y-6 md:space-y-8')}>
          {rows.map((r) => (
            <div
              key={r.operatorId}
              className={clsx(
                'rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/40',
                tvMode && 'border-slate-600 bg-slate-800/40 p-5 md:p-6',
              )}
            >
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p
                    className={clsx(
                      'font-bold text-slate-900 dark:text-slate-100',
                      tvMode ? 'text-lg md:text-xl' : 'text-sm',
                    )}
                  >
                    {r.operatorName}
                  </p>
                  <p className={clsx('text-slate-500', tvMode ? 'text-sm' : 'text-xs')}>{r.operatorEmail}</p>
                </div>
                <Link
                  href={`/dashboard/atendimento/realtime/produtividade/${r.operatorId}`}
                  className={clsx(
                    'font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400',
                    tvMode ? 'text-sm md:text-base' : 'text-xs',
                  )}
                >
                  Painel individual →
                </Link>
              </div>

              {/* Barra atendidas */}
              <div className="mb-3">
                <div className="mb-1 flex justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
                  <span>Atendidas (no filtro)</span>
                  <span className="tabular-nums">{r.atendidas}</span>
                </div>
                <div
                  className={clsx(
                    'h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800',
                    tvMode && 'h-4 md:h-5',
                  )}
                >
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all dark:bg-indigo-400"
                    style={{ width: `${Math.min(100, (r.atendidas / maxAtendidas) * 100)}%` }}
                  />
                </div>
              </div>

              <div
                className={clsx(
                  'grid gap-3 sm:grid-cols-2 lg:grid-cols-4',
                  tvMode && 'gap-4 md:grid-cols-2 lg:grid-cols-4 md:gap-5',
                )}
              >
                <Metric label="Resolvidas" value={String(r.resolvidas)} tvMode={tvMode} />
                <Metric label="MRT médio" value={formatMin(r.mrtMinutesAvg)} tvMode={tvMode} />
                <Metric label="MTTR médio" value={formatMin(r.mttrMinutesAvg)} tvMode={tvMode} />
                <Metric label="SLA ≤10 min" value={`${r.slaIndividualPct}%`} tvMode={tvMode} />
                <Metric label="Críticas" value={String(r.criticas)} tvMode={tvMode} highlight={r.criticas > 0} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  tvMode,
  highlight,
}: {
  label: string;
  value: string;
  tvMode: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={clsx(
        'rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50',
        tvMode && 'border-slate-600 px-4 py-3',
        highlight && 'border-red-400/50 bg-red-950/30',
      )}
    >
      <p className={clsx('font-medium text-slate-500 dark:text-slate-400', tvMode ? 'text-sm' : 'text-[10px]')}>
        {label}
      </p>
      <p
        className={clsx(
          'font-bold tabular-nums text-slate-900 dark:text-slate-100',
          tvMode ? 'text-xl md:text-2xl' : 'text-sm',
          highlight && 'text-red-600 dark:text-red-300',
        )}
      >
        {value}
      </p>
    </div>
  );
}
