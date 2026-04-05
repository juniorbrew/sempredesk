import type { AgentRow, ConvRow, QueueStatsPayload } from '@/lib/realtime-panel-filters';
import { conversaSlaMinutes, minutesSince } from '@/lib/realtime-panel-filters';
import type { RealtimeTVData } from '@/contexts/realtime-tv-data';

const SLA_CRITICO_MIN = 10;
const SLA_ATENCAO_MIN = 5;

function fmtWaitMinutes(totalMin: number): string {
  if (!Number.isFinite(totalMin) || totalMin < 0) return '—';
  const m = Math.floor(totalMin);
  const s = Math.round((totalMin - m) * 60);
  if (m <= 0 && s <= 0) return '<1m';
  if (s > 0) return `${m}m ${s}s`;
  return `${m}m`;
}

function conversaSlaScorePercent(c: ConvRow): number {
  const slaM = conversaSlaMinutes(c);
  return Math.max(0, Math.min(100, Math.round(100 - slaM * 4)));
}

function operatorLoggedLabel(clockIn: string | undefined): string {
  if (!clockIn) return '—';
  const diff = Date.now() - new Date(clockIn).getTime();
  if (Number.isNaN(diff) || diff < 0) return '—';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

/** Monta o payload do Modo TV NOC a partir dos dados já carregados no painel real-time. */
export function buildRealtimeTVDataFromPanel(
  stats: QueueStatsPayload,
  convs: ConvRow[],
  _team: any[],
): RealtimeTVData {
  const activeConvs = convs.filter((c) => c.status !== 'closed');
  const slaScores = activeConvs.map(conversaSlaScorePercent);
  const avgSla =
    slaScores.length > 0 ? Math.round(slaScores.reduce((a, b) => a + b, 0) / slaScores.length) : 100;

  const critical = activeConvs.filter((c) => conversaSlaMinutes(c) > SLA_CRITICO_MIN).length;
  const warning = activeConvs.filter((c) => {
    const m = conversaSlaMinutes(c);
    return m > SLA_ATENCAO_MIN && m <= SLA_CRITICO_MIN;
  }).length;

  const q = stats.queue ?? [];
  const waitingMins = q.map((i) => Number(i.waitingMinutes) || 0);
  const avgWait =
    waitingMins.length > 0 ? waitingMins.reduce((a, b) => a + b, 0) / waitingMins.length : 0;
  const longestWait = waitingMins.length > 0 ? Math.max(...waitingMins) : 0;

  const operators = (stats.agents ?? []).map((a: AgentRow) => ({
    name: a.userName || a.userEmail || '—',
    status: a.availability === 'online' || a.availability === 'paused' ? 'online' : 'offline',
    conversations: a.activeConversations ?? 0,
    sla:
      a.activeConversations > 0
        ? Math.max(0, Math.min(100, 100 - Math.round((a.activeTickets || 0) * 5)))
        : 0,
    time: a.availability === 'offline' ? '—' : operatorLoggedLabel(a.clockIn),
  }));

  const conversations = [...activeConvs]
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt || b.createdAt || 0).getTime() -
        new Date(a.lastMessageAt || a.createdAt || 0).getTime(),
    )
    .slice(0, 12)
    .map((c) => {
      const waitM = minutesSince(c.lastMessageAt || c.createdAt);
      return {
        contact: (c.contactName || c.clientName || '—').trim() || '—',
        channel: c.channel || c.type || '—',
        operator: (c.assignedToName || '—').trim() || '—',
        sla: conversaSlaScorePercent(c),
        wait: waitM < 1 ? '<1m' : `${waitM}m`,
      };
    });

  return {
    indicators: {
      active: activeConvs.length,
      operatorsOnline: stats.summary?.online ?? 0,
      sla: avgSla,
      queue: q.length,
    },
    alerts: { critical, warning },
    operators,
    conversations,
    queue: {
      waiting: q.length,
      avgWait: q.length ? fmtWaitMinutes(avgWait) : '—',
      longestWait: q.length ? fmtWaitMinutes(longestWait) : '—',
    },
  };
}
