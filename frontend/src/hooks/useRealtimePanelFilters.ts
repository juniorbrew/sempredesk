'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useState } from 'react';
import { defaultRealtimeFilters, type RealtimePanelFilters } from '@/lib/realtime-panel-filters';

const STORAGE_KEY = 'sempredesk.realtime.panel.filters.v1';

function readStored(): RealtimePanelFilters {
  if (typeof window === 'undefined') return defaultRealtimeFilters();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultRealtimeFilters();
    const parsed = JSON.parse(raw) as Partial<RealtimePanelFilters>;
    return { ...defaultRealtimeFilters(), ...parsed };
  } catch {
    return defaultRealtimeFilters();
  }
}

/** Filtros partilhados entre Real-Time e rotas de produtividade (sessionStorage). */
export function useRealtimePanelFilters(): [RealtimePanelFilters, Dispatch<SetStateAction<RealtimePanelFilters>>] {
  const [filters, setFilters] = useState<RealtimePanelFilters>(readStored);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters]);

  return [filters, setFilters];
}
