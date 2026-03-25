'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { RefreshCw, Users, MessageSquare, Clock, Send, X, Check, ArrowRightLeft } from 'lucide-react';

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
function timeAgo(date: string | Date) {
  const d = new Date(date).getTime(), diff = Date.now() - d;
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (dy > 0) return `${dy}d`;
  if (h > 0) return `${h}h ${m % 60}min`;
  return m < 1 ? 'agora' : `${m}min`;
}
function clockSince(date: string) {
  const d = new Date(date).getTime(), diff = Date.now() - d;
  const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ── types ─────────────────────────────────────────────────────────────────────
interface Agent {
  userId: string; userName: string; userEmail: string;
  availability: 'online' | 'paused' | 'offline';
  pauseType: string | null; clockIn: string;
  activeTickets: number; activeConversations: number;
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
  lastMessage?: string; assignedTo?: string; contactId?: string;
}

// ── constants ─────────────────────────────────────────────────────────────────
const AVAIL_COLOR: Record<string,string> = { online:'#16A34A', paused:'#D97706', offline:'#9CA3AF' };
const AVAIL_BG:    Record<string,string> = { online:'#F0FDF4', paused:'#FFFBEB', offline:'#F8FAFC' };
const AVAIL_LABEL: Record<string,string> = { online:'Online',  paused:'Em pausa', offline:'Offline' };
const PAUSE_LABEL: Record<string,string> = { lunch:'Almoço', bathroom:'Fisiológica', technical:'Técnica', personal:'Pessoal' };
const PRIO_COLOR:  Record<string,string> = { critical:'#DC2626', high:'#EA580C', medium:'#D97706', low:'#16A34A' };
const PRIO_LABEL:  Record<string,string> = { critical:'Crítica', high:'Alta', medium:'Média', low:'Baixa' };

// ── styles ────────────────────────────────────────────────────────────────────
const S = {
  border: '1px solid rgba(0,0,0,.07)',
  border2: '1px solid rgba(0,0,0,.12)',
  txt: '#111118', txt2: '#6B6B80', txt3: '#A8A8BE',
  bg: '#FFFFFF', bg2: '#F8F8FB', bg3: '#F1F1F6',
  accent: '#4F46E5', accentLight: '#EEF2FF', accentMid: '#C7D2FE',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
export default function SupervisorPage() {
  const [tab, setTab] = useState<'agents'|'conversations'|'queue'>('agents');
  const [stats, setStats]     = useState<QueueStats | null>(null);
  const [convs, setConvs]     = useState<Conv[]>([]);
  const [team, setTeam]       = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastAt, setLastAt]   = useState(new Date());
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null);

  // Transfer modal
  const [transferTicketId, setTransferTicketId]   = useState<string | null>(null);
  const [transferConvLabel, setTransferConvLabel] = useState('');
  const [transferAgentId, setTransferAgentId]     = useState('');
  const [transferring, setTransferring]           = useState(false);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  // ── load ──
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [statsRes, convRes, convTicketRes, teamRes, custRes] = await Promise.all([
        api.getAttendanceQueueStats(),
        api.getConversations({ status: 'active', hasTicket: 'all' }),
        (api as any).getTicketConversations?.({ status: 'active', perPage: 100 }).catch(() => []),
        team.length ? Promise.resolve(team) : api.getTeam(),
        customers.length ? Promise.resolve(customers) : api.getCustomers({ perPage: 300 }),
      ]);
      setStats(statsRes as any);
      const ca: Conv[] = Array.isArray(convRes) ? convRes : (convRes as any)?.data ?? [];
      const ta: Conv[] = Array.isArray(convTicketRes) ? convTicketRes : (convTicketRes as any)?.data ?? [];
      const merged = [...ca.map((c:any) => ({ ...c, type: c.type||'conversation' })), ...ta]
        .sort((a,b) => new Date(b.lastMessageAt||b.createdAt||0).getTime() - new Date(a.lastMessageAt||a.createdAt||0).getTime());
      // dedup by id
      const seen = new Set<string>();
      setConvs(merged.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; }));
      if (!team.length) setTeam(Array.isArray(teamRes) ? teamRes : (teamRes as any)?.data ?? []);
      if (!customers.length) setCustomers(Array.isArray(custRes) ? custRes : (custRes as any)?.data ?? []);
      setLastAt(new Date());
    } catch (e) { console.error(e); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(true), 30_000);
    return () => clearInterval(t);
  }, [load]);

  // ── helpers ──
  const agentName = (id?: string) => {
    if (!id) return null;
    const u = team.find((u:any) => u.id === id);
    return u ? (u.name || u.email) : null;
  };
  const customerName = (id?: string) => {
    if (!id) return null;
    const c = customers.find((c:any) => c.id === id);
    return c ? (c.tradeName || c.companyName) : null;
  };

  // ── transfer ──
  const openTransfer = (ticketId: string, label: string) => {
    setTransferTicketId(ticketId);
    setTransferConvLabel(label);
    setTransferAgentId('');
  };
  const confirmTransfer = async () => {
    if (!transferTicketId || !transferAgentId) return;
    setTransferring(true);
    try {
      await api.assignTicket(transferTicketId, transferAgentId);
      showToast('Atendimento transferido com sucesso!');
      setTransferTicketId(null);
      load(true);
    } catch (e:any) { showToast(e?.response?.data?.message || 'Erro ao transferir', false); }
    setTransferring(false);
  };

  const onlineAgents = stats?.agents.filter(a => a.availability === 'online') ?? [];
  const pausedAgents = stats?.agents.filter(a => a.availability === 'paused') ?? [];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 28px', minHeight: '100vh', background: S.bg3, fontFamily: 'inherit' }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '12px 20px', borderRadius: 10, background: toast.ok ? '#16A34A' : '#DC2626', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,.15)' }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: S.txt }}>Painel do Supervisor</h1>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: S.txt2 }}>
            Visão em tempo real de agentes e atendimentos
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: S.txt3 }}>Atualizado {lastAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          <button onClick={() => load(false)} title="Atualizar"
            style={{ width: 34, height: 34, borderRadius: 9, border: S.border2, background: S.bg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RefreshCw size={15} color={S.txt2} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'Online', value: stats.summary.online, color: '#16A34A', bg: '#F0FDF4', icon: '🟢' },
            { label: 'Em pausa', value: stats.summary.paused, color: '#D97706', bg: '#FFFBEB', icon: '🟡' },
            { label: 'Atendimentos ativos', value: convs.filter(c => c.status !== 'closed').length, color: S.accent, bg: S.accentLight, icon: '💬' },
            { label: 'Na fila (sem agente)', value: stats.summary.queueLength, color: '#DC2626', bg: '#FEF2F2', icon: '⏳' },
          ].map(({ label, value, color, bg, icon }) => (
            <div key={label} style={{ background: S.bg, borderRadius: 12, padding: '16px 20px', border: S.border, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{icon}</div>
              <div>
                <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 11, color: S.txt2, marginTop: 4, fontWeight: 500 }}>{label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ background: S.bg, borderRadius: 14, border: S.border, overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: S.border, padding: '0 20px' }}>
          {([
            ['agents', `Agentes (${stats?.summary.total ?? 0})`],
            ['conversations', `Atendimentos (${convs.filter(c => c.status !== 'closed').length})`],
            ['queue', `Fila (${stats?.summary.queueLength ?? 0})`],
          ] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600, color: tab === key ? S.accent : S.txt2,
                borderBottom: `2px solid ${tab === key ? S.accent : 'transparent'}`, marginBottom: -1, transition: 'color .15s' }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ padding: 20 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: S.txt3 }}>
              <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" style={{ margin: '0 auto 12px' }} />
              Carregando...
            </div>
          ) : (
            <>
              {/* ── TAB AGENTES ─────────────────────────────────────── */}
              {tab === 'agents' && (
                <div>
                  {/* Online */}
                  {onlineAgents.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: S.txt3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                        Online — {onlineAgents.length}
                      </div>
                      <AgentTable agents={onlineAgents} />
                    </div>
                  )}
                  {/* Em pausa */}
                  {pausedAgents.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: S.txt3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                        Em pausa — {pausedAgents.length}
                      </div>
                      <AgentTable agents={pausedAgents} />
                    </div>
                  )}
                  {onlineAgents.length === 0 && pausedAgents.length === 0 && (
                    <EmptyState icon={<Users size={32} />} text="Nenhum agente clocked-in no momento" />
                  )}
                </div>
              )}

              {/* ── TAB ATENDIMENTOS ─────────────────────────────────── */}
              {tab === 'conversations' && (
                <div>
                  {convs.filter(c => c.status !== 'closed').length === 0 ? (
                    <EmptyState icon={<MessageSquare size={32} />} text="Nenhum atendimento ativo no momento" />
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Contato / Cliente', 'Canal', 'Agente', 'Ticket', 'Última mensagem', 'Aguarda', ''].map(h => (
                            <th key={h} style={{ textAlign: 'left', fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase', letterSpacing: '.06em', padding: '0 12px 10px 0', borderBottom: S.border }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {convs.filter(c => c.status !== 'closed').map((c) => {
                          const isWa = c.channel === 'whatsapp';
                          const agent = agentName(c.assignedTo);
                          const client = customerName(c.clientId);
                          const ticketId = c.ticketId || (c.type === 'ticket' ? c.id?.replace?.(/^ticket:/, '') : null);
                          return (
                            <tr key={c.id} style={{ borderBottom: S.border }}>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarBg(c.contactName || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                    {initials(c.contactName || '?')}
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: S.txt }}>{c.contactName || '—'}</div>
                                    {client && <div style={{ fontSize: 11, color: S.txt2 }}>{client}</div>}
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 5, background: isWa ? '#DCFCE7' : S.accentLight, color: isWa ? '#15803D' : S.accent }}>
                                  {isWa ? 'WhatsApp' : 'Portal'}
                                </span>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                {agent ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: avatarBg(agent), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                                      {initials(agent)}
                                    </div>
                                    <span style={{ fontSize: 12, color: S.txt, fontWeight: 500 }}>{agent}</span>
                                  </div>
                                ) : (
                                  <span style={{ fontSize: 11, color: '#D97706', fontWeight: 500 }}>Sem agente</span>
                                )}
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                {c.ticketNumber
                                  ? <span style={{ fontFamily: 'monospace', fontSize: 12, color: S.accent, fontWeight: 600 }}>{c.ticketNumber}</span>
                                  : <span style={{ fontSize: 11, color: S.txt3 }}>—</span>}
                              </td>
                              <td style={{ padding: '12px 12px 12px 0', maxWidth: 220 }}>
                                <span style={{ fontSize: 12, color: S.txt2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                                  {c.lastMessage || '—'}
                                </span>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontSize: 12, color: S.txt3 }}>{timeAgo(c.lastMessageAt || c.createdAt || new Date())}</span>
                              </td>
                              <td style={{ padding: '12px 0' }}>
                                {ticketId && (
                                  <button onClick={() => openTransfer(ticketId, c.contactName || c.ticketNumber || ticketId)}
                                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 7, border: S.border2, background: S.bg2, color: S.txt, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                                    <ArrowRightLeft size={13} /> Transferir
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

              {/* ── TAB FILA ─────────────────────────────────────────── */}
              {tab === 'queue' && (
                <div>
                  {!stats?.queue.length ? (
                    <EmptyState icon={<Clock size={32} />} text="Nenhum ticket na fila no momento" />
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
                        {stats.queue.map((q) => {
                          const waiting = q.waitingMinutes;
                          const waitColor = waiting > 30 ? '#DC2626' : waiting > 10 ? '#EA580C' : S.txt2;
                          return (
                            <tr key={q.ticketId} style={{ borderBottom: S.border }}>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: 12, color: S.accent, fontWeight: 700 }}>{q.ticketNumber}</span>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0', maxWidth: 200 }}>
                                <span style={{ fontSize: 13, color: S.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', fontWeight: 500 }}>{q.subject}</span>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: S.txt }}>{q.clientName || '—'}</div>
                                {q.contactName && <div style={{ fontSize: 11, color: S.txt2 }}>{q.contactName}</div>}
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 5, background: q.origin === 'whatsapp' ? '#DCFCE7' : S.accentLight, color: q.origin === 'whatsapp' ? '#15803D' : S.accent }}>
                                  {q.origin === 'whatsapp' ? 'WhatsApp' : 'Portal'}
                                </span>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: PRIO_COLOR[q.priority] ?? S.txt2 }}>
                                  {PRIO_LABEL[q.priority] ?? q.priority}
                                </span>
                              </td>
                              <td style={{ padding: '12px 12px 12px 0' }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: waitColor }}>
                                  {waiting < 1 ? 'agora' : waiting < 60 ? `${waiting}min` : `${Math.floor(waiting/60)}h${waiting%60}min`}
                                </span>
                              </td>
                              <td style={{ padding: '12px 0' }}>
                                <button onClick={() => openTransfer(q.ticketId, q.ticketNumber)}
                                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 7, border: 'none', background: S.accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
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

      {/* ── Modal Transferir / Atribuir ─────────────────────────────────────── */}
      {transferTicketId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }} onClick={() => setTransferTicketId(null)}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, boxShadow: '0 16px 48px rgba(0,0,0,0.2)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Transferir Atendimento</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94A3B8' }}>{transferConvLabel}</p>
              </div>
              <button onClick={() => setTransferTicketId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {team.filter((u:any) => ['technician','admin','manager'].includes(u.role)).map((u:any) => {
                const agentStat = stats?.agents.find(a => a.userId === u.id);
                const isOnline = agentStat?.availability === 'online';
                return (
                  <button key={u.id} onClick={() => setTransferAgentId(u.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${transferAgentId === u.id ? S.accent : '#E2E8F0'}`, background: transferAgentId === u.id ? S.accentLight : '#fff', cursor: 'pointer', textAlign: 'left', transition: 'all .12s' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: transferAgentId === u.id ? S.accent : avatarBg(u.name || u.email || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                        {initials(u.name || u.email || '?')}
                      </div>
                      <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: isOnline ? '#16A34A' : '#9CA3AF', border: '2px solid #fff' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{u.name || u.email}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: isOnline ? '#16A34A' : '#9CA3AF', fontWeight: 500 }}>
                        {isOnline ? `Online · ${agentStat?.activeTickets ?? 0} tickets` : 'Offline'}
                      </p>
                    </div>
                    {transferAgentId === u.id && <Check size={16} color={S.accent} />}
                  </button>
                );
              })}
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setTransferTicketId(null)} style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={confirmTransfer} disabled={!transferAgentId || transferring}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: !transferAgentId ? '#E2E8F0' : S.accent, color: !transferAgentId ? '#94A3B8' : '#fff', fontSize: 13, fontWeight: 700, cursor: !transferAgentId ? 'not-allowed' : 'pointer', opacity: transferring ? 0.7 : 1 }}>
                {transferring ? 'Transferindo...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function AgentTable({ agents }: { agents: Agent[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['Agente', 'Status', 'Logado há', 'Tickets ativos', 'Conversas ativas'].map(h => (
            <th key={h} style={{ textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#A8A8BE', textTransform: 'uppercase', letterSpacing: '.06em', padding: '0 12px 10px 0', borderBottom: '1px solid rgba(0,0,0,.07)' }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {agents.map((a) => (
          <tr key={a.userId} style={{ borderBottom: '1px solid rgba(0,0,0,.07)' }}>
            <td style={{ padding: '12px 12px 12px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarBg(a.userName), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                    {initials(a.userName)}
                  </div>
                  <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: AVAIL_COLOR[a.availability], border: '2px solid #fff' }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111118' }}>{a.userName}</div>
                  <div style={{ fontSize: 11, color: '#6B6B80' }}>{a.userEmail}</div>
                </div>
              </div>
            </td>
            <td style={{ padding: '12px 12px 12px 0' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 6, background: AVAIL_BG[a.availability], color: AVAIL_COLOR[a.availability] }}>
                {AVAIL_LABEL[a.availability]}
                {a.pauseType ? ` · ${PAUSE_LABEL[a.pauseType] ?? a.pauseType}` : ''}
              </span>
            </td>
            <td style={{ padding: '12px 12px 12px 0' }}>
              <span style={{ fontSize: 12, color: '#6B6B80', fontFamily: 'monospace' }}>{clockSince(a.clockIn)}</span>
            </td>
            <td style={{ padding: '12px 12px 12px 0' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: a.activeTickets > 0 ? '#4F46E5' : '#A8A8BE' }}>{a.activeTickets}</span>
            </td>
            <td style={{ padding: '12px 0' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: a.activeConversations > 0 ? '#16A34A' : '#A8A8BE' }}>{a.activeConversations}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ padding: 48, textAlign: 'center', color: '#A8A8BE' }}>
      <div style={{ opacity: 0.3, marginBottom: 12 }}>{icon}</div>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{text}</p>
    </div>
  );
}
