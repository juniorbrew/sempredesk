'use client';

import type { Dispatch, SetStateAction } from 'react';
import type { RealtimePanelFilters } from '@/lib/realtime-panel-filters';
import { defaultRealtimeFilters } from '@/lib/realtime-panel-filters';

type TeamUser = { id: string; name?: string; email?: string };

type Props = {
  filters: RealtimePanelFilters;
  setFilters: Dispatch<SetStateAction<RealtimePanelFilters>>;
  sortedTeam: TeamUser[];
};

export function RealtimeFiltersPanel({ filters, setFilters, sortedTeam }: Props) {
  return (
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
            {sortedTeam.map((u) => (
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
  );
}
