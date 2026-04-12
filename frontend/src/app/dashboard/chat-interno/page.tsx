'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Send, Search, User, Paperclip, Phone, MoreHorizontal, FileText, Ticket as TicketIcon } from 'lucide-react';
import { EmojiPicker } from '@/components/ui/EmojiPicker';
import { api } from '@/lib/api';
import { resolveWsBase } from '@/lib/ws-base';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import { usePresenceStore } from '@/store/presence.store';
import { format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { atendimentoUrlWithOpenTicket } from '@/lib/atendimento-ticket-bridge';

const S = {
  bg: '#fff', bg2: '#F8F8FB', bg3: '#F1F1F6',
  bd: 'rgba(0,0,0,0.07)', bd2: 'rgba(0,0,0,0.12)',
  txt: '#111118', txt2: '#6B6B80', txt3: '#A8A8BE',
  accent: '#4F46E5', accentL: '#EEF2FF',
};

const STATUS_CFG: Record<string, { dot: string; label: string }> = {
  online:  { dot: '#22C55E', label: 'Online' },
  away:    { dot: '#F59E0B', label: 'Ausente' },
  busy:    { dot: '#EF4444', label: 'Ocupado' },
  offline: { dot: '#94A3B8', label: 'Offline' },
};

function initials(name: string) {
  return (name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function Avatar({ name, size = 40, color = S.accent }: { name: string; size?: number; color?: string }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${color}, ${color}cc)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: size * 0.3, fontWeight: 700, flexShrink: 0,
    }}>
      {initials(name)}
    </div>
  );
}

function StatusDot({ status, size = 10, border = '#fff' }: { status: string; size?: number; border?: string }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.offline;
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: cfg.dot, border: `2px solid ${border}`,
      display: 'inline-block', flexShrink: 0,
    }} />
  );
}

function dateSeparator(date: Date) {
  if (isToday(date)) return `Hoje · ${format(date, 'HH:mm')}`;
  if (isYesterday(date)) return `Ontem · ${format(date, 'HH:mm')}`;
  return format(date, "dd 'de' MMM · HH:mm", { locale: ptBR });
}

export default function ChatInternoPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canViewAgents = hasPermission(user, 'chat.view_agents');
  const canViewStatus = hasPermission(user, 'chat.view_status');

  const [agents, setAgents]         = useState<any[]>([]);
  const [teamMap, setTeamMap]       = useState<Record<string, any>>({});
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; name: string } | null>(null);
  const [messages, setMessages]     = useState<any[]>([]);
  const [input, setInput]           = useState('');
  const [sending, setSending]       = useState(false);
  const [loading, setLoading]       = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch]         = useState('');
  const [agentTickets, setAgentTickets] = useState<any[]>([]);
  const [unreadByAgent, setUnreadByAgent] = useState<Record<string, number>>({});

  const onlineIds = usePresenceStore(s => s.onlineIds);
  const getStatus = usePresenceStore(s => s.getStatus);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedAgentRef = useRef(selectedAgent);
  selectedAgentRef.current = selectedAgent;

  const loadAgents = async () => {
    try {
      const res: any = await api.getInternalChatUsers();
      setAgents(Array.isArray(res) ? res : res?.data ?? []);
    } catch {}
  };

  const loadConversations = async () => {
    try {
      const res: any = await api.getInternalChatConversations();
      setConversations(Array.isArray(res) ? res : res?.data ?? []);
    } catch {}
  };

  const loadMessages = async (recipientId: string) => {
    setLoadingMessages(true);
    try {
      const res: any = await api.getInternalChatMessages(recipientId);
      setMessages(Array.isArray(res) ? res : res?.data ?? []);
    } catch {}
    setLoadingMessages(false);
  };

  const loadAgentTickets = async (agentId: string) => {
    try {
      const res: any = await api.getTickets({ assignedTo: agentId, perPage: 5, sort: 'createdAt:desc' });
      setAgentTickets(Array.isArray(res) ? res : res?.data ?? []);
    } catch { setAgentTickets([]); }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadAgents(),
      loadConversations(),
      api.getTeam().then((res: any) => {
        const list: any[] = Array.isArray(res) ? res : res?.data ?? [];
        const map: Record<string, any> = {};
        list.forEach(m => { map[m.id] = m; });
        setTeamMap(map);
      }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      loadMessages(selectedAgent.id);
      loadAgentTickets(selectedAgent.id);
      setUnreadByAgent(prev => { const next = { ...prev }; delete next[selectedAgent.id]; return next; });
    }
  }, [selectedAgent?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // WebSocket
  useEffect(() => {
    let socket: any;
    let mounted = true;
    (async () => {
      const token = localStorage.getItem('accessToken');
      if (!token || !user?.tenantId) return;
      const base = resolveWsBase();
      if (!base) return;
      const { io } = await import('socket.io-client');
      socket = io(`${base}/realtime`, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: { token },
      });
      socket.on('connect', () => {
        socket.emit('join-tenant', { tenantId: user.tenantId, userId: user.id });
      });
      socket.on('internal-chat:message', (msg: any) => {
        if (!mounted || !msg) return;
        if (msg.senderId === user?.id) return;
        const sel = selectedAgentRef.current;
        const isForCurrentChat = sel && (
          (msg.senderId === sel.id && msg.recipientId === user?.id) ||
          (msg.recipientId === sel.id && msg.senderId === user?.id)
        );
        if (isForCurrentChat) {
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        } else if (msg.recipientId === user?.id) {
          setUnreadByAgent(prev => ({ ...prev, [msg.senderId]: (prev[msg.senderId] ?? 0) + 1 }));
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(msg.senderName, { body: msg.content, icon: '/favicon.ico' });
          }
          loadConversations();
        } else {
          loadConversations();
        }
      });
    })();
    return () => { mounted = false; if (socket) socket.disconnect(); };
  }, [user?.tenantId, user?.id]);

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (!el) { setInput(v => v + emoji); return; }
    const start = el.selectionStart ?? input.length;
    const end = el.selectionEnd ?? input.length;
    const next = input.slice(0, start) + emoji + input.slice(end);
    setInput(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const send = async () => {
    if (!input.trim() || !selectedAgent || sending) return;
    const content = input.trim();
    setInput('');
    setSending(true);
    const tempId = `temp-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempId, senderId: user?.id, senderName: user?.name ?? '',
      recipientId: selectedAgent.id, content, createdAt: new Date().toISOString(),
    }]);
    try {
      const msg: any = await api.postInternalChatMessage({ recipientId: selectedAgent.id, content });
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: msg.id } : m));
    } catch {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setInput(content);
    }
    setSending(false);
  };

  // Build agent list
  const agentIdsInConvs = new Set(conversations.map(c => c.userId));
  const convMap: Record<string, any> = {};
  conversations.forEach(c => { convMap[c.userId] = c; });

  const allAgents = [
    ...conversations.map(c => ({ id: c.userId, name: c.name, lastAt: c.lastAt })),
    ...agents.filter(a => !agentIdsInConvs.has(a.id)).map(a => ({ id: a.id, name: a.name, lastAt: null })),
  ].filter(a => a.id !== user?.id);

  const filtered = search.trim()
    ? allAgents.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    : allAgents;

  const onlineAgents  = filtered.filter(a => onlineIds.has(String(a.id)));
  const offlineAgents = filtered.filter(a => !onlineIds.has(String(a.id)));

  // Selected agent extra info
  const selTeamMember = selectedAgent ? teamMap[selectedAgent.id] : null;
  const selStatus = selectedAgent ? getStatus(selectedAgent.id) : 'offline';
  const selIsOnline = selectedAgent ? onlineIds.has(String(selectedAgent.id)) : false;
  const openTickets = agentTickets.filter(t => ['open','in_progress','waiting_client'].includes(t.status)).length;

  // Message grouping for date separators
  type MsgGroup = { date: string; messages: any[] };
  const groups: MsgGroup[] = [];
  messages.forEach(msg => {
    const d = format(new Date(msg.createdAt), 'yyyy-MM-dd');
    const last = groups[groups.length - 1];
    if (last && last.date === d) last.messages.push(msg);
    else groups.push({ date: d, messages: [msg] });
  });

  const STATUS_LABELS: Record<string,string> = {
    open:'Aberto', in_progress:'Em andamento', waiting_client:'Aguardando',
    resolved:'Resolvido', closed:'Fechado', cancelled:'Cancelado',
  };

  const agentColors = [
    '#4F46E5','#0284C7','#059669','#D97706','#DC2626','#7C3AED','#0891B2',
  ];
  const agentColor = (id: string) => agentColors[(id?.charCodeAt(0) ?? 0) % agentColors.length];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 44px)', overflow:'hidden', background:S.bg3, fontFamily:"'DM Sans',system-ui,sans-serif" }}>
      {/* Topbar */}
      <div style={{ background:S.bg, borderBottom:`1px solid ${S.bd}`, padding:'0 28px', display:'flex', alignItems:'center', gap:12, height:56, flexShrink:0 }}>
        <div style={{ width:36, height:36, background:S.accentL, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <MessageSquare style={{ width:18, height:18, color:S.accent }} strokeWidth={1.8} />
        </div>
        <div style={{ flex:1 }}>
          <h1 style={{ margin:0, fontSize:16, fontWeight:600, color:S.txt }}>Chat Interno</h1>
          <p style={{ margin:0, fontSize:11, color:S.txt2 }}>Converse em tempo real com outros agentes da equipe</p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#22C55E', fontWeight:600 }}>
          <StatusDot status="online" size={8} border={S.bg3} />
          {onlineIds.size} online agora
        </div>
      </div>

      {/* 3-column body */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* ── Left: Agent list ── */}
        {canViewAgents && (
          <div style={{ width:260, flexShrink:0, background:S.bg, borderRight:`1px solid ${S.bd}`, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {/* Search */}
            <div style={{ padding:'12px 12px 8px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, background:S.bg2, border:`1px solid ${S.bd2}`, borderRadius:8, padding:'7px 10px' }}>
                <Search style={{ width:13, height:13, color:S.txt3, flexShrink:0 }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar agente..."
                  style={{ border:'none', outline:'none', background:'none', fontSize:12, color:S.txt, fontFamily:'inherit', width:'100%' }}
                />
              </div>
            </div>

            <div style={{ flex:1, overflowY:'auto' }}>
              {loading ? (
                <div style={{ padding:32, textAlign:'center', color:S.txt3, fontSize:12 }}>Carregando...</div>
              ) : (
                <>
                  {/* Online */}
                  {onlineAgents.length > 0 && (
                    <>
                      <div style={{ padding:'8px 14px 4px', fontSize:10, fontWeight:700, color:S.txt3, textTransform:'uppercase', letterSpacing:'0.07em', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                        <span>Online</span>
                        <span style={{ background:'#DCFCE7', color:'#15803D', borderRadius:99, padding:'1px 7px', fontSize:10, fontWeight:700 }}>{onlineAgents.length}</span>
                      </div>
                      {onlineAgents.map(a => <AgentRow key={a.id} agent={a} selected={selectedAgent?.id === a.id} unread={unreadByAgent[a.id]} status={getStatus(a.id)} isOnline onClick={() => setSelectedAgent({ id: a.id, name: a.name })} color={agentColor(a.id)} showStatus={canViewStatus} />)}
                    </>
                  )}

                  {/* Offline */}
                  {offlineAgents.length > 0 && (
                    <>
                      <div style={{ padding:'10px 14px 4px', fontSize:10, fontWeight:700, color:S.txt3, textTransform:'uppercase', letterSpacing:'0.07em', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                        <span>Offline</span>
                        <span style={{ background:S.bg2, color:S.txt3, borderRadius:99, padding:'1px 7px', fontSize:10, fontWeight:700 }}>{offlineAgents.length}</span>
                      </div>
                      {offlineAgents.map(a => <AgentRow key={a.id} agent={a} selected={selectedAgent?.id === a.id} unread={unreadByAgent[a.id]} status={getStatus(a.id)} isOnline={false} onClick={() => setSelectedAgent({ id: a.id, name: a.name })} color={agentColor(a.id)} showStatus={canViewStatus} />)}
                    </>
                  )}

                  {onlineAgents.length === 0 && offlineAgents.length === 0 && (
                    <div style={{ padding:32, textAlign:'center', color:S.txt3, fontSize:12 }}>Nenhum agente encontrado</div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Center: Chat area ── */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
          {!selectedAgent ? (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:S.txt3, gap:12 }}>
              <div style={{ width:64, height:64, borderRadius:20, background:S.accentL, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <MessageSquare style={{ width:30, height:30, color:S.accent }} strokeWidth={1.5} />
              </div>
              <p style={{ margin:0, fontSize:15, fontWeight:500, color:S.txt2 }}>Selecione um agente para conversar</p>
              <p style={{ margin:0, fontSize:12, color:S.txt3 }}>Escolha um agente na lista à esquerda</p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div style={{ background:S.bg, borderBottom:`1px solid ${S.bd}`, padding:'0 20px', height:56, display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
                <div style={{ position:'relative', flexShrink:0 }}>
                  <Avatar name={selectedAgent.name} size={36} color={agentColor(selectedAgent.id)} />
                  {canViewStatus && (
                    <span style={{ position:'absolute', bottom:0, right:0 }}>
                      <StatusDot status={selStatus} size={10} border={S.bg} />
                    </span>
                  )}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:600, color:S.txt }}>{selectedAgent.name}</div>
                  {canViewStatus && (
                    <div style={{ fontSize:11, color: selIsOnline ? '#22C55E' : S.txt3, display:'flex', alignItems:'center', gap:4 }}>
                      <StatusDot status={selStatus} size={7} border={S.bg} />
                      {(STATUS_CFG[selStatus] || STATUS_CFG.offline).label}
                    </div>
                  )}
                </div>
                {[
                  { icon: Search, title: 'Buscar mensagens' },
                  { icon: User, title: 'Ver perfil' },
                  { icon: MoreHorizontal, title: 'Mais opções' },
                ].map(({ icon: Icon, title }, i) => (
                  <button key={i} title={title} style={{ width:34, height:34, borderRadius:8, background:'transparent', border:`1px solid ${S.bd2}`, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:S.txt2 }}>
                    <Icon style={{ width:15, height:15 }} />
                  </button>
                ))}
              </div>

              {/* Messages */}
              <div style={{ flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:0, background:S.bg3 }}>
                {loadingMessages ? (
                  <div style={{ textAlign:'center', color:S.txt3, fontSize:12, padding:40 }}>Carregando...</div>
                ) : messages.length === 0 ? (
                  <div style={{ textAlign:'center', color:S.txt3, fontSize:13, marginTop:60 }}>
                    <MessageSquare style={{ width:36, height:36, margin:'0 auto 12px', opacity:0.2 }} />
                    <p>Nenhuma mensagem ainda. Envie a primeira!</p>
                  </div>
                ) : groups.map((group, gi) => (
                  <div key={gi}>
                    {/* Date separator */}
                    <div style={{ display:'flex', alignItems:'center', gap:12, margin:'16px 0' }}>
                      <div style={{ flex:1, height:1, background:S.bd }} />
                      <span style={{ fontSize:11, color:S.txt3, fontWeight:500, whiteSpace:'nowrap' }}>
                        {dateSeparator(new Date(group.messages[0].createdAt))}
                      </span>
                      <div style={{ flex:1, height:1, background:S.bd }} />
                    </div>
                    {/* Messages in group */}
                    {group.messages.map((msg, mi) => {
                      const me = msg.senderId === user?.id;
                      const prevMsg = mi > 0 ? group.messages[mi - 1] : null;
                      const sameAsPrev = prevMsg && prevMsg.senderId === msg.senderId;
                      return (
                        <div key={msg.id} style={{ display:'flex', gap:10, flexDirection: me ? 'row-reverse' : 'row', marginTop: sameAsPrev ? 3 : 12 }}>
                          {/* Avatar (only first in a sequence) */}
                          {!sameAsPrev ? (
                            <Avatar name={msg.senderName} size={32} color={me ? S.accent : agentColor(msg.senderId)} />
                          ) : (
                            <div style={{ width:32, flexShrink:0 }} />
                          )}
                          <div style={{ maxWidth:'68%', display:'flex', flexDirection:'column', alignItems: me ? 'flex-end' : 'flex-start', gap:2 }}>
                            {!sameAsPrev && !me && (
                              <span style={{ fontSize:11, color:S.txt3, marginBottom:2 }}>{msg.senderName}</span>
                            )}
                            <div style={{
                              background: me ? S.accent : S.bg,
                              color: me ? '#fff' : S.txt,
                              borderRadius: me ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                              padding:'9px 13px',
                              fontSize:13,
                              lineHeight:1.5,
                              border: me ? 'none' : `1px solid ${S.bd}`,
                              boxShadow: me ? `0 2px 8px ${S.accent}30` : '0 1px 2px rgba(0,0,0,0.04)',
                            }}>
                              {msg.content}
                            </div>
                            <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:S.txt3 }}>
                              {format(new Date(msg.createdAt), 'HH:mm')}
                              {me && <span style={{ fontSize:11, color: me ? S.accent : S.txt3 }}>✓✓</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input bar */}
              <div style={{ background:S.bg, borderTop:`1px solid ${S.bd}`, padding:'10px 16px', display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                <button type="button" style={{ width:34, height:34, borderRadius:8, background:'transparent', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:S.txt3 }}>
                  <Paperclip style={{ width:16, height:16 }} />
                </button>
                <EmojiPicker onSelect={insertEmoji} position="top" />
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={`Mensagem para ${selectedAgent.name}...`}
                  style={{ flex:1, padding:'9px 14px', border:`1.5px solid ${S.bd2}`, borderRadius:10, fontSize:13, color:S.txt, background:S.bg2, outline:'none', fontFamily:'inherit' }}
                />
                <button
                  onClick={send}
                  disabled={sending || !input.trim()}
                  style={{ width:36, height:36, borderRadius:9, background: input.trim() ? S.accent : S.bg2, border:'none', cursor: input.trim() ? 'pointer' : 'default', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'background .15s' }}>
                  <Send style={{ width:15, height:15, color: input.trim() ? '#fff' : S.txt3 }} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Right: Profile panel ── */}
        {selectedAgent && (
          <div style={{ width:260, flexShrink:0, background:S.bg, borderLeft:`1px solid ${S.bd}`, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ flex:1, overflowY:'auto', padding:'20px 16px', display:'flex', flexDirection:'column', gap:20 }}>

              {/* Avatar + name */}
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, paddingBottom:16, borderBottom:`1px solid ${S.bd}` }}>
                <div style={{ position:'relative' }}>
                  <Avatar name={selectedAgent.name} size={72} color={agentColor(selectedAgent.id)} />
                  {canViewStatus && (
                    <span style={{ position:'absolute', bottom:2, right:2 }}>
                      <StatusDot status={selStatus} size={14} border={S.bg} />
                    </span>
                  )}
                </div>
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:14, fontWeight:700, color:S.txt }}>{selectedAgent.name}</div>
                  {selTeamMember?.role && (
                    <div style={{ fontSize:11, color:S.txt2, marginTop:2 }}>{selTeamMember.role}</div>
                  )}
                </div>
                {canViewStatus && (
                  <div style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:99, background: selIsOnline ? '#DCFCE7' : S.bg2, border:`1px solid ${selIsOnline ? '#86EFAC' : S.bd2}` }}>
                    <StatusDot status={selStatus} size={7} border="transparent" />
                    <span style={{ fontSize:11, fontWeight:600, color: selIsOnline ? '#15803D' : S.txt3 }}>
                      {(STATUS_CFG[selStatus] || STATUS_CFG.offline).label}
                    </span>
                  </div>
                )}
              </div>

              {/* Informações */}
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:S.txt3, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>Informações</div>
                {[
                  { label:'Departamento', value: selTeamMember?.department || '—' },
                  { label:'Nível',        value: selTeamMember?.role || '—' },
                  { label:'Tickets hoje', value: agentTickets.filter(t => { const d = new Date(t.createdAt); return isToday(d); }).length },
                  { label:'Em aberto',    value: openTickets },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:`1px solid ${S.bd}` }}>
                    <span style={{ fontSize:12, color:S.txt2 }}>{label}</span>
                    <span style={{ fontSize:12, fontWeight:600, color: label === 'Em aberto' && Number(value) > 0 ? S.accent : S.txt }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Tickets em comum */}
              {agentTickets.length > 0 && (
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:S.txt3, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>Tickets em Comum</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {agentTickets.slice(0, 4).map((t: any) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => router.push(atendimentoUrlWithOpenTicket(t.id))}
                        style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'8px 10px', borderRadius:8, background:S.bg2, border:`1px solid ${S.bd}`, textDecoration:'none', transition:'background .1s', width:'100%', textAlign:'left' as const, cursor:'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.background = S.bg3)}
                        onMouseLeave={e => (e.currentTarget.style.background = S.bg2)}
                      >
                        <TicketIcon style={{ width:13, height:13, color:S.accent, flexShrink:0, marginTop:2 }} />
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:11, fontWeight:600, color:S.accent, fontFamily:"'DM Mono',monospace" }}>{t.ticketNumber}</div>
                          <div style={{ fontSize:11, color:S.txt, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.subject}</div>
                          <div style={{ fontSize:10, color:S.txt3, marginTop:1 }}>{STATUS_LABELS[t.status] || t.status}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentRow({ agent, selected, unread, status, isOnline, onClick, color, showStatus }: {
  agent: any; selected: boolean; unread?: number; status: string;
  isOnline: boolean; onClick: () => void; color: string; showStatus: boolean;
}) {
  const lastAtLabel = agent.lastAt ? (() => {
    const d = new Date(agent.lastAt);
    if (isToday(d)) return format(d, 'HH:mm');
    if (isYesterday(d)) return 'Ontem';
    return format(d, 'dd/MM', { locale: ptBR });
  })() : null;

  return (
    <button
      onClick={onClick}
      style={{
        width:'100%', padding:'9px 14px', display:'flex', alignItems:'center', gap:10,
        border:'none', background: selected ? '#EEF2FF' : 'transparent',
        borderLeft:`3px solid ${selected ? '#4F46E5' : 'transparent'}`,
        cursor:'pointer', textAlign:'left', transition:'background .1s',
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = '#F8F8FB'; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >
      <div style={{ position:'relative', flexShrink:0 }}>
        <Avatar name={agent.name} size={36} color={color} />
        {showStatus && (
          <span style={{ position:'absolute', bottom:0, right:0 }}>
            <StatusDot status={status} size={10} border="#fff" />
          </span>
        )}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'#111118', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{agent.name}</div>
        {lastAtLabel && <div style={{ fontSize:11, color:'#A8A8BE', marginTop:1 }}>{lastAtLabel}</div>}
      </div>
      {unread ? (
        <span style={{ minWidth:18, height:18, borderRadius:99, background:'#4F46E5', color:'#fff', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 5px', flexShrink:0 }}>
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </button>
  );
}
