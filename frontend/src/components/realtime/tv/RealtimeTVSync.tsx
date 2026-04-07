'use client';

import { useEffect } from 'react';
import { useRealtimeTVSetData } from '@/contexts/realtime-tv-data';
import { useRealtimePanelData } from '@/hooks/useRealtimePanelData';
import { buildRealtimeTVDataFromPanel } from '@/lib/realtime-tv-mapper';

/**
 * Sincroniza o Modo TV NOC com os mesmos dados do painel real-time (REST + eventos via useRealtimePanelData).
 * Não altera useRealtimePanelData nem o socket global partilhado.
 */
export function RealtimeTVSync() {
  const setData = useRealtimeTVSetData();
  const { stats, convs, team, loading } = useRealtimePanelData();

  useEffect(() => {
    if (!setData || !stats || loading) return;
    setData(buildRealtimeTVDataFromPanel(stats, convs, team));
  }, [stats, convs, team, loading, setData]);

  return null;
}
