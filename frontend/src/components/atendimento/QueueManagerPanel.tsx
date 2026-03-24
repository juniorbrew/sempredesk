'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import {
  Users, RefreshCw, Clock, Ticket, MessageSquare, Phone,
  ChevronDown, UserCheck, AlertCircle, X, Check,
} from 'lucide-react';

// ── helpers ───────────────────────────────────────────────────────────────────
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return p.length === 1 ? (p[0][0] || '?').toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function avatarBg(name: string) {
  const C = ['#4F46E5','#16A34A','#EA580C','#7C3AED','#E11D48','#0891B2','#B45309'];
  let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return C[Math.abs(h) % C.length];
}
function waitLabel(mins: number) {
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}min`;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#DC2626', high: '#EA580C', medium: '#D97706', low: '#16A34A',
};
const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Crítica', high: 'Alta', medium: 'Média', low: 'Baixa',
};
const AVAIL_COLOR: Record<string, string> = {
  online: '#16A34A', paused: '#D97706', offline: '#9CA3AF',
};
const AVAIL_LABEL: Record<string, string> = {
  online: 'Online', paused: 'Em pausa', offline: 'Offline',
};
const PAUSE_LABEL: Record<string, string> = {
  lunch: 'Almoço', bathroom: 'Fisiológica', technical: 'Técnica', personal: 'Pessoal',
};

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

interface Props {
  onClose: () => void;
  onAssigned?: () => void;
}

export default function QueueManagerPanel({ onClose, onAssigned }: Props) {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res: any = await api.getAttendanceQueueStats();
      setStats(res as QueueStats);
      setLastRefresh(new Date());
    } catch { if (!silent) setStats(null); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(() => load(true), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const assign = async (ticketId: string, agentId: string, agentName: string) => {
    setAssigning(ticketId);
    setOpenDropdown(null);
    try {
      await api.assignTicket(ticketId, agentId);
      showToast(`Atribuído para ${agentName}`);
      await load(true);
      onAssigned?.();
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Erro ao atribuir', 'err');
    }
    setAssigning(null);
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 1100,
          background: toast.type === 'ok' ? '#16A34A' : '#DC2626',
          color: '#fff', padding: '10px 18px', borderRadius: 8,
          fontSize: 13, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,.25)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Drawer */}
      <div style={{
        width: '100%', maxWidth: 920, height: '100vh',
        background: '#F8F8FB', display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 32px rgba(0,0,0,.18)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 20px', background: '#fff', borderBottom: '1px solid #E8E8EF',
          flexShrink: 0,
        }}>
          <Users size={20} style={{ color: '#4F46E5' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111118' }}>Gestão de Fila</div>
            <div style={{ fontSize: 12, color: '#6B6B80' }}>
              {stats ? `${stats.summary.online} online · ${stats.summary.paused} em pausa · ${stats.summary.queueLength} na fila` : 'carregando...'}
            </div>
          </div>
          <span style={{ fontSize: 11, color: '#A8A8BE' }}>
            Atualizado {lastRefresh.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button onClick={() => load()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B6B80', padding: 4 }}>
            <RefreshCw size={16} />
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B6B80', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {loading && !stats ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6B80', fontSize: 14 }}>
            <RefreshCw size={20} style={{ marginRight: 8, animation: 'spin 1s linear infinite' }} /> Carregando...
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', gap: 0 }}>

            {/* ── LEFT: Agents ────────────────────────────────────────────── */}
            <div style={{
              width: 300, flexShrink: 0, overflowY: 'auto',
              borderRight: '1px solid #E8E8EF', background: '#fff',
            }}>
              <div style={{ padding: '12px 16px 8px', fontSize: 11, fontWeight: 700, color: '#A8A8BE', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Agentes ({stats?.agents.length ?? 0})
              </div>

              {!stats?.agents.length && (
                <div style={{ padding: '24px 16px', color: '#A8A8BE', fontSize: 13, textAlign: 'center' }}>
                  <Users size={28} style={{ display: 'block', margin: '0 auto 8px', opacity: .4 }} />
                  Nenhum agente ativo
                </div>
              )}

              {(stats?.agents ?? []).map(agent => {
                const color = AVAIL_COLOR[agent.availability] ?? '#9CA3AF';
                const bg = avatarBg(agent.userName || 'A');
                return (
                  <div key={agent.userId} style={{
                    padding: '12px 16px', borderBottom: '1px solid #F1F1F6',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    {/* Avatar */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: '50%',
                        background: bg, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 13,
                      }}>
                        {initials(agent.userName || 'A')}
                      </div>
                      <div style={{
                        position: 'absolute', bottom: -1, right: -1,
                        width: 11, height: 11, borderRadius: '50%',
                        background: color, border: '2px solid #fff',
                      }} />
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#111118', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {agent.userName}
                      </div>
                      <div style={{ fontSize: 11, color, fontWeight: 500 }}>
                        {AVAIL_LABEL[agent.availability]}
                        {agent.pauseType ? ` · ${PAUSE_LABEL[agent.pauseType] ?? agent.pauseType}` : ''}
                      </div>
                    </div>

                    {/* Counts */}
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: agent.activeTickets > 4 ? '#FEF2F2' : agent.activeTickets > 2 ? '#FFF7ED' : '#F0FDF4',
                        color: agent.activeTickets > 4 ? '#DC2626' : agent.activeTickets > 2 ? '#EA580C' : '#16A34A',
                        borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 700,
                      }}>
                        <Ticket size={10} />
                        {agent.activeTickets}
                      </div>
                      <div style={{ fontSize: 10, color: '#A8A8BE', marginTop: 2 }}>tickets ativos</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── RIGHT: Queue ─────────────────────────────────────────────── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 16px' }}>
              <div style={{ padding: '12px 20px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#A8A8BE', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
                  Fila de espera ({stats?.queue.length ?? 0})
                </div>
                {(stats?.queue.length ?? 0) === 0 && (
                  <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 600 }}>✓ Fila vazia</span>
                )}
              </div>

              {!stats?.queue.length ? (
                <div style={{ padding: '40px 20px', color: '#A8A8BE', fontSize: 13, textAlign: 'center' }}>
                  <Check size={32} style={{ display: 'block', margin: '0 auto 10px', color: '#16A34A', opacity: .6 }} />
                  Nenhuma conversa aguardando atribuição
                </div>
              ) : (stats.queue.map(item => {
                const priColor = PRIORITY_COLORS[item.priority] ?? '#6B6B80';
                const isAssigning = assigning === item.ticketId;
                const isOpen = openDropdown === item.ticketId;
                const onlineAgents = (stats.agents ?? []).filter(a => a.availability === 'online');

                return (
                  <div key={item.ticketId} style={{
                    margin: '8px 16px',
                    background: '#fff', borderRadius: 10,
                    border: '1px solid #E8E8EF',
                    boxShadow: '0 1px 4px rgba(0,0,0,.06)',
                    overflow: 'hidden',
                  }}>
                    {/* Priority bar */}
                    <div style={{ height: 3, background: priColor }} />

                    <div style={{ padding: '12px 14px' }}>
                      {/* Row 1: number + badges */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: '#4F46E5' }}>
                          #{item.ticketNumber}
                        </span>
                        {/* origin badge */}
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          background: item.origin === 'whatsapp' ? '#DCFCE7' : '#EEF2FF',
                          color: item.origin === 'whatsapp' ? '#16A34A' : '#4F46E5',
                          borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 600,
                        }}>
                          {item.origin === 'whatsapp'
                            ? <><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> WhatsApp</>
                            : <><MessageSquare size={8} /> Portal</>
                          }
                        </span>
                        {/* priority badge */}
                        <span style={{
                          background: `${priColor}18`, color: priColor,
                          borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 600,
                        }}>
                          {PRIORITY_LABELS[item.priority] ?? item.priority}
                        </span>
                        {/* wait time */}
                        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: item.waitingMinutes > 30 ? '#DC2626' : item.waitingMinutes > 10 ? '#EA580C' : '#6B6B80' }}>
                          <Clock size={10} />
                          {waitLabel(item.waitingMinutes)}
                        </span>
                      </div>

                      {/* Row 2: subject */}
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#111118', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.subject}
                      </div>

                      {/* Row 3: client + contact */}
                      <div style={{ fontSize: 11, color: '#6B6B80', marginBottom: 10 }}>
                        {item.clientName}{item.contactName !== '—' ? ` · ${item.contactName}` : ''}
                      </div>

                      {/* Assign button */}
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={() => setOpenDropdown(isOpen ? null : item.ticketId)}
                          disabled={isAssigning}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            background: isAssigning ? '#F1F1F6' : '#4F46E5',
                            color: isAssigning ? '#A8A8BE' : '#fff',
                            border: 'none', borderRadius: 7, padding: '7px 14px',
                            fontSize: 12, fontWeight: 600, cursor: isAssigning ? 'default' : 'pointer',
                          }}
                        >
                          <UserCheck size={13} />
                          {isAssigning ? 'Atribuindo...' : 'Atribuir para agente'}
                          {!isAssigning && <ChevronDown size={12} />}
                        </button>

                        {/* Agent dropdown */}
                        {isOpen && (
                          <div style={{
                            position: 'absolute', top: '100%', left: 0, marginTop: 4,
                            background: '#fff', border: '1px solid #E8E8EF', borderRadius: 8,
                            boxShadow: '0 8px 24px rgba(0,0,0,.14)', zIndex: 50,
                            minWidth: 220, overflow: 'hidden',
                          }}>
                            {onlineAgents.length === 0 ? (
                              <div style={{ padding: '12px 14px', fontSize: 12, color: '#A8A8BE', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <AlertCircle size={13} /> Nenhum agente online
                              </div>
                            ) : (
                              <>
                                <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, color: '#A8A8BE', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                  Agentes Online
                                </div>
                                {onlineAgents
                                  .sort((a, b) => a.activeTickets - b.activeTickets)
                                  .map(agent => (
                                    <button
                                      key={agent.userId}
                                      onClick={() => assign(item.ticketId, agent.userId, agent.userName)}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        width: '100%', padding: '9px 12px', textAlign: 'left',
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        borderTop: '1px solid #F1F1F6',
                                      }}
                                      onMouseEnter={e => (e.currentTarget.style.background = '#F8F8FB')}
                                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                    >
                                      <div style={{
                                        width: 28, height: 28, borderRadius: '50%',
                                        background: avatarBg(agent.userName),
                                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 11, fontWeight: 700, flexShrink: 0,
                                      }}>
                                        {initials(agent.userName)}
                                      </div>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: '#111118' }}>{agent.userName}</div>
                                        <div style={{ fontSize: 10, color: '#6B6B80' }}>{agent.activeTickets} ticket{agent.activeTickets !== 1 ? 's' : ''} ativo{agent.activeTickets !== 1 ? 's' : ''}</div>
                                      </div>
                                      <div style={{
                                        width: 20, height: 20, borderRadius: '50%',
                                        background: agent.activeTickets < 3 ? '#F0FDF4' : agent.activeTickets < 5 ? '#FFF7ED' : '#FEF2F2',
                                        color: agent.activeTickets < 3 ? '#16A34A' : agent.activeTickets < 5 ? '#EA580C' : '#DC2626',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 10, fontWeight: 700,
                                      }}>
                                        {agent.activeTickets}
                                      </div>
                                    </button>
                                  ))}

                                {/* Also show paused agents (disabled) */}
                                {(stats.agents ?? []).filter(a => a.availability === 'paused').length > 0 && (
                                  <>
                                    <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, color: '#A8A8BE', textTransform: 'uppercase', letterSpacing: '0.05em', borderTop: '1px solid #F1F1F6' }}>
                                      Em Pausa
                                    </div>
                                    {(stats.agents ?? []).filter(a => a.availability === 'paused').map(agent => (
                                      <button
                                        key={agent.userId}
                                        onClick={() => assign(item.ticketId, agent.userId, agent.userName)}
                                        style={{
                                          display: 'flex', alignItems: 'center', gap: 10,
                                          width: '100%', padding: '9px 12px', textAlign: 'left',
                                          background: 'none', border: 'none', cursor: 'pointer',
                                          opacity: 0.6, borderTop: '1px solid #F1F1F6',
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.background = '#F8F8FB')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                      >
                                        <div style={{
                                          width: 28, height: 28, borderRadius: '50%',
                                          background: avatarBg(agent.userName),
                                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          fontSize: 11, fontWeight: 700, flexShrink: 0,
                                        }}>
                                          {initials(agent.userName)}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontSize: 12, fontWeight: 600, color: '#111118' }}>{agent.userName}</div>
                                          <div style={{ fontSize: 10, color: '#D97706' }}>
                                            Em pausa{agent.pauseType ? ` · ${PAUSE_LABEL[agent.pauseType] ?? agent.pauseType}` : ''}
                                          </div>
                                        </div>
                                      </button>
                                    ))}
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
