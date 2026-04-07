import type { AgentRow, ConvRow } from '@/lib/realtime-panel-filters';
import { average, productivitySlaMinutes } from '@/lib/realtime-panel-filters';

const SLA_OK_MAX = 10;

function diffMinutes(startIso: string | undefined, endIso: string | undefined): number | null {
  if (!startIso || !endIso) return null;
  const t0 = new Date(startIso).getTime();
  const t1 = new Date(endIso).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  return Math.max(0, Math.floor((t1 - t0) / 60000));
}

/**
 * MRT (proxy): da abertura da conversa até a última mensagem de agente registada na API.
 * Nota: o backend expõe MAX(agente); aproxima tempo até resposta quando há pouca troca.
 */
export function mrtMinutesForConversation(c: ConvRow): number | null {
  if (!c.lastAgentMessageAt) return null;
  return diffMinutes(c.createdAt, c.lastAgentMessageAt);
}

/** MTTR: da abertura até fecho (updatedAt em conversas fechadas). */
export function mttrMinutesForConversation(c: ConvRow): number | null {
  if (c.status !== 'closed') return null;
  return diffMinutes(c.createdAt, c.updatedAt || c.lastMessageAt);
}

/**
 * Agente mínimo para métricas quando o utilizador não aparece em `stats.agents` (sem ponto na fila).
 */
export function buildSyntheticAgentRowForProductivity(
  userId: string,
  teamUser?: { name?: string; email?: string } | null,
  /** Nome vindo das conversas (`assignedToName`) quando o user não está na equipa. */
  nameHintFromConversations?: string,
): AgentRow {
  const hint = nameHintFromConversations?.trim();
  return {
    userId,
    userName: teamUser?.name || teamUser?.email || hint || 'Operador',
    userEmail: teamUser?.email || '—',
    availability: 'offline',
    pauseType: null,
    pauseSince: null,
    clockIn: '',
    activeTickets: 0,
    activeConversations: 0,
    finishedToday: 0,
    activeConvList: [],
  };
}

export type OperatorProductivityRow = {
  operatorId: string;
  operatorName: string;
  operatorEmail: string;
  clockIn: string;
  atendidas: number;
  resolvidas: number;
  mrtMinutesAvg: number | null;
  mttrMinutesAvg: number | null;
  slaIndividualPct: number;
  criticas: number;
};

/**
 * Métricas por operador a partir de conversas e agentes já filtrados.
 */
export function computeOperatorProductivity(
  conversations: ConvRow[],
  agents: AgentRow[],
  teamNameById: Map<string, string>,
): OperatorProductivityRow[] {
  return agents.map((a) => {
    const convs = conversations.filter((c) => c.assignedTo === a.userId);
    const atendidas = convs.length;
    const resolvidas = convs.filter((c) => c.status === 'closed').length;
    const mrtVals = convs.map(mrtMinutesForConversation).filter((x): x is number => x != null);
    const mttrVals = convs.map(mttrMinutesForConversation).filter((x): x is number => x != null);
    const mrtMinutesAvg = mrtVals.length ? average(mrtVals) : null;
    const mttrMinutesAvg = mttrVals.length ? average(mttrVals) : null;
    const withSla = convs.filter((c) => productivitySlaMinutes(c) <= SLA_OK_MAX).length;
    const slaIndividualPct = atendidas ? Math.round((withSla / atendidas) * 1000) / 10 : 0;
    const criticas = convs.filter((c) => productivitySlaMinutes(c) > SLA_OK_MAX).length;
    const operatorName = a.userName || teamNameById.get(a.userId) || '—';
    return {
      operatorId: a.userId,
      operatorName,
      operatorEmail: a.userEmail,
      clockIn: a.clockIn,
      atendidas,
      resolvidas,
      mrtMinutesAvg,
      mttrMinutesAvg,
      slaIndividualPct,
      criticas,
    };
  });
}

export type RankedOperatorRow = OperatorProductivityRow & { rank: number };

export function computeOperatorRanking(rows: OperatorProductivityRow[]): RankedOperatorRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.resolvidas !== a.resolvidas) return b.resolvidas - a.resolvidas;
    if (b.atendidas !== a.atendidas) return b.atendidas - a.atendidas;
    if (a.criticas !== b.criticas) return a.criticas - b.criticas;
    return a.operatorName.localeCompare(b.operatorName, 'pt', { sensitivity: 'base' });
  });
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

export type OperatorHourChartPoint = {
  hora: string;
  conversas: number;
  slaPct: number | null;
  mrtAvg: number | null;
  mttrAvg: number | null;
};

/**
 * Agrega por hora do dia (hoje, timezone local) usando lastMessageAt.
 */
export function computeOperatorCharts(conversations: ConvRow[], operatorId: string): OperatorHourChartPoint[] {
  const mine = conversations.filter((c) => c.assignedTo === operatorId);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + 86400000;

  const buckets: OperatorHourChartPoint[] = [];
  for (let h = 0; h < 24; h++) {
    buckets.push({
      hora: `${String(h).padStart(2, '0')}h`,
      conversas: 0,
      slaPct: null,
      mrtAvg: null,
      mttrAvg: null,
    });
  }

  for (const c of mine) {
    const t = new Date(c.lastMessageAt || c.createdAt || 0).getTime();
    if (Number.isNaN(t) || t < start || t >= end) continue;
    const hour = new Date(t).getHours();
    const b = buckets[hour];
    if (!b) continue;
    b.conversas += 1;
  }

  for (let h = 0; h < 24; h++) {
    const hourConvs = mine.filter((c) => {
      const t = new Date(c.lastMessageAt || c.createdAt || 0).getTime();
      if (Number.isNaN(t) || t < start || t >= end) return false;
      return new Date(t).getHours() === h;
    });
    if (!hourConvs.length) continue;
    const slaOk = hourConvs.filter((c) => productivitySlaMinutes(c) <= SLA_OK_MAX).length;
    buckets[h].slaPct = Math.round((slaOk / hourConvs.length) * 1000) / 10;
    const mrts = hourConvs.map(mrtMinutesForConversation).filter((x): x is number => x != null);
    const mttrs = hourConvs.map(mttrMinutesForConversation).filter((x): x is number => x != null);
    buckets[h].mrtAvg = mrts.length ? average(mrts) : null;
    buckets[h].mttrAvg = mttrs.length ? average(mttrs) : null;
  }

  return buckets;
}

/** Série para comparativo: top N operadores — conversas por hora (hoje). */
export function computeComparativeConversationsByHour(
  conversations: ConvRow[],
  operatorIds: string[],
): { hora: string; [key: string]: string | number }[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + 86400000;
  const rows: { hora: string; [key: string]: string | number }[] = [];
  for (let h = 0; h < 24; h++) {
    const row: { hora: string; [key: string]: string | number } = { hora: `${String(h).padStart(2, '0')}h` };
    for (const oid of operatorIds) {
      const n = conversations.filter((c) => {
        if (c.assignedTo !== oid) return false;
        const t = new Date(c.lastMessageAt || c.createdAt || 0).getTime();
        if (Number.isNaN(t) || t < start || t >= end) return false;
        return new Date(t).getHours() === h;
      }).length;
      row[oid] = n;
    }
    rows.push(row);
  }
  return rows;
}
