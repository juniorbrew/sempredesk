'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { REALTIME_ENABLED } from '@/lib/realtime';
import { RefreshCw, X, Check, ArrowRightLeft, Send } from 'lucide-react';
import { usePresenceStore } from '@/store/presence.store';

// ── helpers ───────────────────────────────────────────────────────────────────
function initials(name: string) {
  const p = (name || '?').trim().split(/\s+/);
  return p.length === 1 ? (p[0][0] || '?').toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function avatarBg(name: string) {
  const C = ['#4F46E5','#16A34A','#EA580C','#7C3AED','#E11D48','#0891B2','#B45309'];
  let h = 0; for (let i = 0; i < (name||'').length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return C[Math.abs(h) % C.length];
}
function clockSince(date: string | Date | null) {
  if (!date) return '00:00:00';
  const diff = Date.now() - new Date(date).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function timeAgo(date: string | Date) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}min`;
  return m < 1 ? 'agora' : `${m}min`;
}

// ── types ─────────────────────────────────────────────────────────────────────
interface ConvItem {
  convId: string; ticketId: string; ticketNumber: string;
  contactName: string; channel: string; lastMessageAt: string;
}
interface Agent {
  userId: string; userName: string; userEmail: string;
  availability: 'online' | 'paused' | 'offline';
  pauseType: string | null; pauseSince: string | null; clockIn: string;
  activeTickets: number; activeConversations: number;
  finishedToday: number; activeConvList: ConvItem[];
}
interface QueueItem {
  ticketId: string; ticketNumber: string; subject: string;
  priority: string; origin: string; createdAt: string;
  conversationId: string | null; clientName: string;
  contactName: string; waitingMinutes: number;
}
interface QueueStats {
  agents: Agent[];
  queue: QueueItem[];
  summary: { online: number; paused: number; total: number; queueLength: number };
}
interface Conv {
  id: string; type?: string; contactName?: string; clientId?: string;
  ticketId?: string; ticketNumber?: string; channel?: string;
  status?: string; lastMessageAt?: string; createdAt?: string;
  lastMessage?: string; assignedTo?: string; assignedToName?: string;
  clientName?: string;
}

// ── constants ─────────────────────────────────────────────────────────────────
const PAUSE_LABEL: Record<string,string> = { lunch:'Almoço', bathroom:'Fisiológica', technical:'Técnica', personal:'Pessoal' };
const PRIO_COLOR:  Record<string,string> = { critical:'#DC2626', high:'#EA580C', medium:'#D97706', low:'#16A34A' };
const PRIO_LABEL:  Record<string,string> = { critical:'Crítica', high:'Alta', medium:'Média', low:'Baixa' };

const S = {
  border: '1px solid rgba(0,0,0,.07)',
  border2: '1px solid rgba(0,0,0,.12)',
  txt: '#111118', txt2: '#6B6B80', txt3: '#A8A8BE',
  bg: '#FFFFFF', bg2: '#F8F8FB', bg3: '#F1F1F6',
  accent: '#4F46E5', accentLight: '#EEF2FF',
} as const;

// ── Ícone de estado (▶ / ⏸ / ✖) ─────────────────────────────────────────────
function StatusIcon({ availability, pauseType }: { availability: string; pauseType: string | null }) {
  if (availability === 'online') {
    return (
      <div title="Online" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="13" fill="#DCFCE7" stroke="#16A34A" strokeWidth="1.5"/>
          <polygon points="11,9 21,14 11,19" fill="#16A34A"/>
        </svg>
        <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 600 }}>Online</span>
      </div>
    );
  }
  if (availability === 'paused') {
    return (
      <div title={`Em pausa${pauseType ? ` · ${PAUSE_LABEL[pauseType] ?? pauseType}` : ''}`}
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="13" fill="#FFFBEB" stroke="#D97706" strokeWidth="1.5"/>
          <rect x="9" y="9" width="4" height="10" rx="1.5" fill="#D97706"/>
          <rect x="15" y="9" width="4" height="10" rx="1.5" fill="#D97706"/>
        </svg>
        <span style={{ fontSize: 11, color: '#D97706', fontWeight: 600 }}>
          {pauseType ? PAUSE_LABEL[pauseType] ?? pauseType : 'Em pausa'}
        </span>
      </div>
    );
  }
  return (
    <div title="Offline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="14" r="13" fill="#FEF2F2" stroke="#DC2626" strokeWidth="1.5"/>
        <line x1="9" y1="9" x2="19" y2="19" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"/>
        <line x1="19" y1="9" x2="9" y2="19" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>Offline</span>
    </div>
  );
}

// ── Célula de chats com hover mostrando lista ─────────────────────────────────
function ChatsCell({ agent, onOpenConv }: { agent: Agent; onOpenConv: (ticketId: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = agent.activeConversations;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => count > 0 && setOpen(v => !v)}
        style={{
          background: count > 0 ? S.accentLight : S.bg3,
          border: `1px solid ${count > 0 ? '#C7D2FE' : 'rgba(0,0,0,.08)'}`,
          borderRadius: 8, padding: '4px 12px', cursor: count > 0 ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 800, color: count > 0 ? S.accent : S.txt3 }}>
          {count}
        </span>
        {count > 0 && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: .5 }}>
            <path d="M2 4l3 3 3-3" stroke={S.accent} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
      </button>

      {open && count > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200, marginTop: 4,
          background: S.bg, border: S.border2, borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 280, overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 14px', borderBottom: S.border, fontSize: 11, fontWeight: 700, color: S.txt3, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Conversas ativas — {agent.userName.split(' ')[0]}
          </div>
          {agent.activeConvList.map(c => (
            <button
              key={c.convId}
              onClick={() => { onOpenConv(c.ticketId); setOpen(false); }}
              style={{
                width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                background: 'transparent', border: 'none', borderBottom: S.border,
                cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = S.bg2)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                background: avatarBg(c.contactName), color: '#fff',
                fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {initials(c.contactName)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: S.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.contactName}
                </div>
                <div style={{ fontSize: 10, color: S.txt3 }}>
                  {c.ticketNumber} · {c.channel === 'whatsapp' ? 'WhatsApp' : 'Portal'} · {timeAgo(c.lastMessageAt)}
                </div>
              </div>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, opacity: .4 }}>
                <path d="M2 6.5h9M7.5 2.5l4 4-4 4" stroke={S.txt} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tabela de agentes (layout estilo Kentro) ──────────────────────────────────
function AgentTable({
  agents, onTransfer, onOpenConv,
}: {
  agents: Agent[];
  onTransfer: (agentId: string, agentName: string) => void;
  onOpenConv: (ticketId: string) => void;
}) {
  const [, setTick] = useState(0);

  // Relógio ao vivo — atualiza a cada segundo
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const COLS = ['Agente', 'Fila', 'Estado', 'Chats', 'Finalizados', 'Logado', 'Pausa', 'Funções'];

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {COLS.map(h => (
            <th key={h} style={{
              textAlign: h === 'Funções' ? 'right' : 'left',
              fontSize: 10, fontWeight: 700, color: S.txt3,
              textTransform: 'uppercase', letterSpacing: '.06em',
              padding: '0 12px 10px 0', borderBottom: S.border,
              whiteSpace: 'nowrap',
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {agents.map(a => (
          <tr key={a.userId} style={{ borderBottom: S.border }}
            onMouseEnter={e => (e.currentTarget.style.background = S.bg2)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {/* Agente */}
            <td style={{ padding: '12px 12px 12px 0', minWidth: 180 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: avatarBg(a.userName), color: '#fff',
                  fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {initials(a.userName)}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: S.txt }}>{a.userName}</div>
                  <div style={{ fontSize: 11, color: S.txt3 }}>{a.userEmail}</div>
                </div>
              </div>
            </td>

            {/* Fila (tickets ativos) */}
            <td style={{ padding: '12px 12px 12px 0' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 28, height: 22, borderRadius: 6, padding: '0 8px',
                fontSize: 12, fontWeight: 700,
                background: a.activeTickets > 0 ? '#EEF2FF' : S.bg3,
                color: a.activeTickets > 0 ? S.accent : S.txt3,
              }}>
                {a.activeTickets}
              </span>
            </td>

            {/* Estado — ícone visual */}
            <td style={{ padding: '12px 12px 12px 0' }}>
              <StatusIcon availability={a.availability} pauseType={a.pauseType} />
            </td>

            {/* Chats atribuídos com hover */}
            <td style={{ padding: '12px 12px 12px 0' }}>
              <ChatsCell agent={a} onOpenConv={onOpenConv} />
            </td>

            {/* Finalizados hoje */}
            <td style={{ padding: '12px 12px 12px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  fontSize: 14, fontWeight: 700,
                  color: a.finishedToday > 0 ? '#16A34A' : S.txt3,
                }}>
                  {a.finishedToday}
                </span>
                {a.finishedToday > 0 && (
                  <span style={{ fontSize: 9, color: '#16A34A', fontWeight: 600 }}>hoje</span>
                )}
              </div>
            </td>

            {/* Logado há (relógio ao vivo) */}
            <td style={{ padding: '12px 12px 12px 0' }}>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: S.txt2, fontWeight: 600 }}>
                {clockSince(a.clockIn)}
              </span>
            </td>

            {/* Pausa (tempo em pausa atual ou 00:00:00) */}
            <td style={{ padding: '12px 12px 12px 0' }}>
              <span style={{
                fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
                color: a.availability === 'paused' ? '#D97706' : S.txt3,
              }}>
                {a.availability === 'paused' ? clockSince(a.pauseSince) : '00:00:00'}
              </span>
            </td>

            {/* Funções */}
            <td style={{ padding: '12px 0', textAlign: 'right' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                {/* Transferir todos os atendimentos */}
                <button
                  onClick={() => onTransfer(a.userId, a.userName)}
                  title="Transferir atendimentos"
                  style={{
                    width: 30, height: 30, borderRadius: 7, border: S.border2,
                    background: S.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: S.txt2,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = S.accentLight; (e.currentTarget as HTMLButtonElement).style.color = S.accent; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = S.bg; (e.currentTarget as HTMLButtonElement).style.color = S.txt2; }}
                >
                  <ArrowRightLeft size={13} strokeWidth={1.8} />
                </button>
                {/* Info (placeholder) */}
                <button
                  title="Ver detalhes"
                  style={{
                    width: 30, height: 30, borderRadius: 7, border: S.border2,
                    background: S.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: S.txt2,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = S.bg2; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = S.bg; }}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M6.5 5.5v4M6.5 4h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function SupervisorPage() {
  const [tab, setTab]     = useState<'agents'|'conversations'|'queue'|'history'>('agents');
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [team, setTeam]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastAt, setLastAt]   = useState(new Date());
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null);

  // Histórico de ponto
  const [history, setHistory]         = useState<any[]>([]);
  const [historyDate, setHistoryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [historyLoading, setHistoryLoading] = useState(false);

  // Reage a mudanças de presença (WebSocket) → reload imediato dos stats
  const onlineIds = usePresenceStore(s => s.onlineIds);

  // Modal transferir
  const [transferModal, setTransferModal] = useState<{ ticketId?: string; agentId?: string; agentName?: string; mode: 'ticket'|'agent' } | null>(null);
  const [transferAgentId, setTransferAgentId] = useState('');
  const [transferring, setTransferring]       = useState(false);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [statsRes, convRes, teamRes] = await Promise.all([
        api.getAttendanceQueueStats(),
        api.getConversations({ status: 'active' }),
        team.length ? Promise.resolve(team) : api.getTeam(),
      ]);
      setStats(statsRes as any);
      const ca: Conv[] = Array.isArray(convRes) ? convRes : (convRes as any)?.data ?? [];
      setConvs(ca.sort((a,b) => new Date(b.lastMessageAt||b.createdAt||0).getTime() - new Date(a.lastMessageAt||a.createdAt||0).getTime()));
      if (!team.length) setTeam(Array.isArray(teamRes) ? teamRes : (teamRes as any)?.data ?? []);
      setLastAt(new Date());
    } catch (e) { console.error(e); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHistory = useCallback(async (date: string) => {
    setHistoryLoading(true);
    try {
      // endDate = dia seguinte para cobrir todo o dia selecionado
      const next = new Date(date); next.setDate(next.getDate() + 1);
      const endDate = next.toISOString().slice(0, 10);
      const res: any = await api.getAttendance({ startDate: date, endDate, perPage: 100 });
      const rows = Array.isArray(res) ? res : (res?.data ?? []);
      setHistory(rows);
    } catch {}
    setHistoryLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Polling de backup a cada 15s
  useEffect(() => {
    const t = setInterval(() => load(true), 15_000);
    return () => clearInterval(t);
  }, [load]);

  // Reload imediato quando presença muda via WebSocket (agente entra/sai)
  const prevSizeRef = useRef(onlineIds.size);
  useEffect(() => {
    if (prevSizeRef.current !== onlineIds.size) {
      prevSizeRef.current = onlineIds.size;
      load(true);
    }
  }, [onlineIds, load]);

  // Reload imediato ao receber evento de transferência/atribuição de ticket
  useEffect(() => {
    if (!REALTIME_ENABLED) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    let socket: any;
    (async () => {
      const { resolveWsBase } = await import('@/lib/ws-base');
      const WS_BASE = resolveWsBase();
      if (!token || !WS_BASE) return;
      const { io } = await import('socket.io-client');
      const user = (await import('@/store/auth.store')).useAuthStore.getState().user;
      if (!user?.tenantId) return;
      socket = io(`${WS_BASE}/realtime`, { path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } });
      socket.emit('join-tenant', { tenantId: user.tenantId, userId: user.id });
      socket.on('queue:updated', () => load(true));
    })();
    return () => { if (socket) socket.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carrega histórico ao abrir aba ou mudar data
  useEffect(() => {
    if (tab === 'history') loadHistory(historyDate);
  }, [tab, historyDate, loadHistory]);

  const agentName = (id?: string) => {
    const u = team.find((u:any) => u.id === id);
    return u ? (u.name || u.email) : null;
  };

  // Transferir ticket para agente
  const confirmTransfer = async () => {
    if (!transferAgentId) return;
    setTransferring(true);
    try {
      if (transferModal?.ticketId) {
        await api.assignTicket(transferModal.ticketId, transferAgentId);
        showToast('Transferido com sucesso!');
      } else if (transferModal?.agentId) {
        // Transferir todos os tickets do agente
        const agentConvs = stats?.agents.find(a => a.userId === transferModal.agentId)?.activeConvList ?? [];
        await Promise.all(agentConvs.map(c => api.assignTicket(c.ticketId, transferAgentId)));
        showToast(`${agentConvs.length} atendimento(s) transferido(s)!`);
      }
      setTransferModal(null);
      setTransferAgentId('');
      load(true);
    } catch (e:any) { showToast(e?.response?.data?.message || 'Erro ao transferir', false); }
    setTransferring(false);
  };

  const openConvTransfer = (ticketId: string) => {
    setTransferModal({ ticketId, mode: 'ticket' });
    setTransferAgentId('');
  };
  const openAgentTransfer = (agentId: string, agentName: string) => {
    setTransferModal({ agentId, agentName, mode: 'agent' });
    setTransferAgentId('');
  };

  const summary = stats?.summary;

  return (
    <div style={{ padding: '24px 28px', minHeight: '100vh', background: S.bg2, fontFamily: 'inherit' }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '12px 20px', borderRadius: 10, background: toast.ok ? '#16A34A' : '#DC2626', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,.15)' }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: S.txt }}>Painel do Supervisor</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: S.txt2 }}>
            Visão em tempo real · atualizado às {lastAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
        <button onClick={() => load(false)} title="Atualizar"
          style={{ width: 34, height: 34, borderRadius: 9, border: S.border2, background: S.bg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <RefreshCw size={15} color={S.txt2} strokeWidth={1.6} />
        </button>
      </div>

      {/* Cards de resumo */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 22 }}>
          {[
            { label: 'Online',              value: summary.online,      color: '#16A34A', bg: '#F0FDF4', icon: '🟢' },
            { label: 'Em pausa',            value: summary.paused,      color: '#D97706', bg: '#FFFBEB', icon: '🟡' },
            { label: 'Atendimentos ativos', value: convs.filter(c => c.status !== 'closed').length, color: S.accent, bg: '#EEF2FF', icon: '💬' },
            { label: 'Na fila',             value: summary.queueLength, color: '#DC2626', bg: '#FEF2F2', icon: '⏳' },
          ].map(({ label, value, color, bg, icon }) => (
            <div key={label} style={{ background: S.bg, borderRadius: 12, padding: '14px 18px', border: S.border, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{icon}</div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 11, color: S.txt2, marginTop: 3, fontWeight: 500 }}>{label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Abas */}
      <div style={{ background: S.bg, borderRadius: 14, border: S.border, overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: S.border, padding: '0 16px', gap: 0 }}>
          {([
            ['agents',        `Painel de Agentes (${summary?.total ?? 0})`],
            ['conversations', `Painel de Atendimentos (${convs.filter(c => c.status !== 'closed').length})`],
            ['queue',         `Fila (${summary?.queueLength ?? 0})`],
            ['history',       'Histórico de Ponto'],
          ] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{
                padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                color: tab === key ? S.accent : S.txt2,
                borderBottom: `2px solid ${tab === key ? S.accent : 'transparent'}`,
                marginBottom: -1, transition: 'color .15s', whiteSpace: 'nowrap',
              }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ padding: 20, overflowX: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: S.txt3 }}>Carregando...</div>
          ) : (
            <>
              {/* ── ABA AGENTES ─────────────────────────────────────────────── */}
              {tab === 'agents' && (
                <div>
                  {(stats?.agents.length ?? 0) === 0 ? (
                    <div style={{ padding: 48, textAlign: 'center', color: S.txt3 }}>
                      <div style={{ fontSize: 32, marginBottom: 8, opacity: .3 }}>👤</div>
                      <p style={{ margin: 0, fontSize: 13 }}>Nenhum agente em turno no momento</p>
                    </div>
                  ) : (
                    <AgentTable
                      agents={stats!.agents}
                      onTransfer={openAgentTransfer}
                      onOpenConv={openConvTransfer}
                    />
                  )}
                </div>
              )}

              {/* ── ABA ATENDIMENTOS ─────────────────────────────────────────── */}
              {tab === 'conversations' && (
                <div>
                  {convs.filter(c => c.status !== 'closed').length === 0 ? (
                    <div style={{ padding: 48, textAlign: 'center', color: S.txt3 }}>
                      <div style={{ fontSize: 32, marginBottom: 8, opacity: .3 }}>💬</div>
                      <p style={{ margin: 0, fontSize: 13 }}>Nenhum atendimento ativo</p>
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Contato', 'Canal', 'Agente', 'Ticket', 'Aguarda', ''].map(h => (
                            <th key={h} style={{ textAlign: 'left', fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase', letterSpacing: '.06em', padding: '0 12px 10px 0', borderBottom: S.border }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {convs.filter(c => c.status !== 'closed').map(c => {
                          const isWa = c.channel === 'whatsapp';
                          const agent = c.assignedToName || agentName(c.assignedTo);
                          return (
                            <tr key={c.id} style={{ borderBottom: S.border }}
                              onMouseEnter={e => (e.currentTarget.style.background = S.bg2)}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarBg(c.contactName || '?'), color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    {initials(c.contactName || '?')}
                                  </div>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: S.txt }}>{c.contactName || '—'}</span>
                                </div>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: isWa ? '#DCFCE7' : '#EEF2FF', color: isWa ? '#15803D' : S.accent }}>
                                  {isWa ? 'WhatsApp' : 'Portal'}
                                </span>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                {agent ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: avatarBg(agent), color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(agent)}</div>
                                    <span style={{ fontSize: 12, color: S.txt }}>{agent}</span>
                                  </div>
                                ) : <span style={{ fontSize: 11, color: '#D97706' }}>Sem agente</span>}
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                {c.ticketNumber
                                  ? <span style={{ fontFamily: 'monospace', fontSize: 12, color: S.accent, fontWeight: 700 }}>{c.ticketNumber}</span>
                                  : <span style={{ fontSize: 11, color: S.txt3 }}>—</span>}
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontSize: 12, color: S.txt3 }}>{timeAgo(c.lastMessageAt || c.createdAt || new Date().toISOString())}</span>
                              </td>
                              <td style={{ padding: '12px 0' }}>
                                {c.ticketId && (
                                  <button onClick={() => openConvTransfer(c.ticketId!)}
                                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: S.border2, background: S.bg2, color: S.txt, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                                    <ArrowRightLeft size={12} /> Transferir
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* ── ABA HISTÓRICO DE PONTO ───────────────────────────────────── */}
              {tab === 'history' && (
                <div>
                  {/* Filtro de data */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: S.txt2 }}>Data:</label>
                    <input
                      type="date"
                      value={historyDate}
                      onChange={e => setHistoryDate(e.target.value)}
                      style={{ fontSize: 13, padding: '5px 10px', borderRadius: 7, border: S.border2, color: S.txt, background: S.bg, fontFamily: 'inherit' }}
                    />
                    {historyLoading && <span style={{ fontSize: 11, color: S.txt3 }}>Carregando...</span>}
                  </div>

                  {history.length === 0 && !historyLoading ? (
                    <div style={{ padding: 48, textAlign: 'center', color: S.txt3 }}>
                      <div style={{ fontSize: 32, marginBottom: 8, opacity: .3 }}>📋</div>
                      <p style={{ margin: 0, fontSize: 13 }}>Nenhum registro de ponto para esta data</p>
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Agente', 'Entrada', 'Saída', 'Duração', 'Pausa', 'Status', 'Observação'].map(h => (
                            <th key={h} style={{ textAlign: 'left', fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase', letterSpacing: '.06em', padding: '0 12px 10px 0', borderBottom: S.border, whiteSpace: 'nowrap' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((r: any) => {
                          const cin  = r.clockIn  ? new Date(r.clockIn)  : null;
                          const cout = r.clockOut ? new Date(r.clockOut) : null;
                          const durMs  = cout && cin ? cout.getTime() - cin.getTime() : (cin ? Date.now() - cin.getTime() : 0);
                          const durH   = Math.floor(durMs / 3600000);
                          const durM   = Math.floor((durMs % 3600000) / 60000);
                          const durStr = cin ? `${durH}h ${String(durM).padStart(2,'0')}min` : '—';
                          const fmtTime = (d: Date | null) => d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
                          const isOnline = !r.clockOut;
                          return (
                            <tr key={r.id} style={{ borderBottom: S.border }}
                              onMouseEnter={e => (e.currentTarget.style.background = S.bg2)}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              {/* Agente */}
                              <td style={{ padding: '10px 12px 10px 0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarBg(r.userName || r.userEmail || '?'), color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    {initials(r.userName || r.userEmail || '?')}
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: S.txt }}>{r.userName || '—'}</div>
                                    <div style={{ fontSize: 10, color: S.txt3 }}>{r.userEmail}</div>
                                  </div>
                                </div>
                              </td>
                              {/* Entrada */}
                              <td style={{ padding: '10px 12px 10px 0' }}>
                                <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#16A34A', fontWeight: 600 }}>
                                  {fmtTime(cin)}
                                </span>
                                {r.ipAddress && <div style={{ fontSize: 10, color: S.txt3, marginTop: 1 }}>{r.ipAddress}</div>}
                              </td>
                              {/* Saída */}
                              <td style={{ padding: '10px 12px 10px 0' }}>
                                {cout
                                  ? <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#DC2626', fontWeight: 600 }}>{fmtTime(cout)}</span>
                                  : <span style={{ fontSize: 11, fontWeight: 700, color: '#16A34A' }}>● Em turno</span>
                                }
                              </td>
                              {/* Duração */}
                              <td style={{ padding: '10px 12px 10px 0' }}>
                                <span style={{ fontSize: 12, fontFamily: 'monospace', color: S.txt2, fontWeight: 600 }}>{durStr}</span>
                              </td>
                              {/* Pausa total */}
                              <td style={{ padding: '10px 12px 10px 0' }}>
                                {(r.totalPauseMinutes ?? 0) > 0
                                  ? <span style={{ fontSize: 12, color: '#D97706', fontWeight: 600 }}>{Math.floor((r.totalPauseMinutes ?? 0) / 60)}h {(r.totalPauseMinutes ?? 0) % 60}min</span>
                                  : <span style={{ fontSize: 11, color: S.txt3 }}>—</span>
                                }
                              </td>
                              {/* Status */}
                              <td style={{ padding: '10px 12px 10px 0' }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
                                  background: isOnline ? '#DCFCE7' : '#F1F5F9',
                                  color: isOnline ? '#15803D' : S.txt2,
                                }}>
                                  {isOnline ? 'Online' : 'Encerrado'}
                                </span>
                              </td>
                              {/* Observação */}
                              <td style={{ padding: '10px 0', maxWidth: 180 }}>
                                <span style={{ fontSize: 11, color: S.txt3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                                  {r.notes || '—'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* ── ABA FILA ─────────────────────────────────────────────────── */}
              {tab === 'queue' && (
                <div>
                  {!stats?.queue.length ? (
                    <div style={{ padding: 48, textAlign: 'center', color: S.txt3 }}>
                      <div style={{ fontSize: 32, marginBottom: 8, opacity: .3 }}>✅</div>
                      <p style={{ margin: 0, fontSize: 13 }}>Fila vazia — todos os chamados estão atribuídos</p>
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Ticket', 'Assunto', 'Cliente / Contato', 'Canal', 'Prioridade', 'Aguardando', 'Ação'].map(h => (
                            <th key={h} style={{ textAlign: 'left', fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase', letterSpacing: '.06em', padding: '0 12px 10px 0', borderBottom: S.border }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stats.queue.map(q => {
                          const waitColor = q.waitingMinutes > 30 ? '#DC2626' : q.waitingMinutes > 10 ? '#EA580C' : S.txt2;
                          return (
                            <tr key={q.ticketId} style={{ borderBottom: S.border }}
                              onMouseEnter={e => (e.currentTarget.style.background = S.bg2)}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: 12, color: S.accent, fontWeight: 700 }}>{q.ticketNumber}</span>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0', maxWidth: 200 }}>
                                <span style={{ fontSize: 13, color: S.txt, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{q.subject}</span>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: S.txt }}>{q.clientName}</div>
                                {q.contactName && <div style={{ fontSize: 11, color: S.txt2 }}>{q.contactName}</div>}
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: q.origin === 'whatsapp' ? '#DCFCE7' : '#EEF2FF', color: q.origin === 'whatsapp' ? '#15803D' : S.accent }}>
                                  {q.origin === 'whatsapp' ? 'WhatsApp' : 'Portal'}
                                </span>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: PRIO_COLOR[q.priority] ?? S.txt2 }}>{PRIO_LABEL[q.priority] ?? q.priority}</span>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: waitColor }}>
                                  {q.waitingMinutes < 1 ? 'agora' : q.waitingMinutes < 60 ? `${q.waitingMinutes}min` : `${Math.floor(q.waitingMinutes/60)}h${q.waitingMinutes%60}min`}
                                </span>
                              </td>
                              <td style={{ padding: '12px 0' }}>
                                <button onClick={() => openConvTransfer(q.ticketId)}
                                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: 'none', background: S.accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                                  <Send size={12} /> Atribuir
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Modal Transferir ─────────────────────────────────────────────────── */}
      {transferModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }} onClick={() => setTransferModal(null)}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 420, boxShadow: '0 16px 48px rgba(0,0,0,.2)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
                  {transferModal.mode === 'agent' ? `Transferir atendimentos de ${transferModal.agentName}` : 'Transferir atendimento'}
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: '#94A3B8' }}>Selecione o agente destino</p>
              </div>
              <button onClick={() => setTransferModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
              {team.filter((u:any) => ['technician','admin','manager'].includes(u.role) && u.id !== transferModal.agentId).map((u:any) => {
                const agentStat = stats?.agents.find(a => a.userId === u.id);
                const isOnline  = agentStat?.availability === 'online';
                return (
                  <button key={u.id} onClick={() => setTransferAgentId(u.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, border: `1.5px solid ${transferAgentId === u.id ? S.accent : '#E2E8F0'}`, background: transferAgentId === u.id ? '#EEF2FF' : '#fff', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarBg(u.name || u.email), color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {initials(u.name || u.email)}
                      </div>
                      <span style={{ position: 'absolute', bottom: 0, right: 0, width: 9, height: 9, borderRadius: '50%', background: isOnline ? '#16A34A' : '#9CA3AF', border: '2px solid #fff' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{u.name || u.email}</p>
                      <p style={{ margin: '1px 0 0', fontSize: 10, color: isOnline ? '#16A34A' : '#9CA3AF', fontWeight: 500 }}>
                        {isOnline ? `Online · ${agentStat?.activeTickets ?? 0} tickets` : 'Offline'}
                      </p>
                    </div>
                    {transferAgentId === u.id && <Check size={14} color={S.accent} />}
                  </button>
                );
              })}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setTransferModal(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={confirmTransfer} disabled={!transferAgentId || transferring}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: !transferAgentId ? '#E2E8F0' : S.accent, color: !transferAgentId ? '#94A3B8' : '#fff', fontSize: 12, fontWeight: 700, cursor: !transferAgentId ? 'not-allowed' : 'pointer', opacity: transferring ? .7 : 1 }}>
                {transferring ? 'Transferindo...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
