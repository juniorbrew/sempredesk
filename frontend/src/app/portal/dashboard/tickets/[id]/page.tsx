'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { usePortalStore } from '@/store/portal.store';
import { portalFetch } from '@/lib/portal-fetch';
import { useRealtimeTicket } from '@/lib/realtime';
import { ArrowLeft, Send, User, Headphones, RefreshCw, AlertTriangle, UserCircle, MessageSquare, PhoneCall, ThumbsUp, ThumbsDown, CheckCircle, XCircle, ChevronUp } from 'lucide-react';

const API_BASE = '/api/v1';

const STATUS_LABELS: Record<string,string> = { open:'Aberto', in_progress:'Em andamento', waiting_client:'Aguardando', resolved:'Resolvido', closed:'Fechado', cancelled:'Cancelado' };
const STATUS_STYLE: Record<string,{ bg:string; color:string; dot:string }> = {
  open:{ bg:'#DBEAFE', color:'#1D4ED8', dot:'#3B82F6' }, in_progress:{ bg:'#FEF9C3', color:'#854D0E', dot:'#F59E0B' },
  waiting_client:{ bg:'#FFEDD5', color:'#C2410C', dot:'#F97316' }, resolved:{ bg:'#DCFCE7', color:'#15803D', dot:'#10B981' },
  closed:{ bg:'#F1F5F9', color:'#475569', dot:'#94A3B8' }, cancelled:{ bg:'#FEE2E2', color:'#DC2626', dot:'#EF4444' },
};
const PRIORITY_LABELS: Record<string,string> = { low:'Baixa', medium:'Média', high:'Alta', critical:'Crítica' };

export default function PortalDashboardTicketDetailPage() {
  const { id } = useParams();
  const { accessToken, client, contact } = usePortalStore();
  const [ticket, setTicket] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [focusMsg, setFocusMsg] = useState(false);
  const [showClient, setShowClient] = useState(true);
  const [showAgent, setShowAgent] = useState(true);
  const [showUpdates, setShowUpdates] = useState(true);
  const [satisfying, setSatisfying] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [msgMediaUrls, setMsgMediaUrls] = useState<Record<string, string>>({});
  const msgMediaUrlsRef = useRef<Record<string, string>>({});
  msgMediaUrlsRef.current = msgMediaUrls;
  const msgMediaInFlightRef = useRef<Set<string>>(new Set());
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const routeTicketRef = decodeURIComponent(Array.isArray(id) ? id[0] : String(id || ''));
  const isUuidTicketRef = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(routeTicketRef);
  const apiTicketId = ticket?.id || routeTicketRef;

  const STATUS_PT: Record<string,string> = { open:'Aberto', in_progress:'Em Andamento', waiting_client:'Aguardando Cliente', resolved:'Resolvido', closed:'Fechado', cancelled:'Cancelado', low:'Baixa', medium:'Média', high:'Alta', critical:'Crítico' };

  const daysUntilAutoClose = (resolvedAt: string | null): number | null => {
    if (!resolvedAt) return null;
    const deadline = new Date(resolvedAt).getTime() + 7 * 24 * 3600 * 1000;
    const diff = Math.ceil((deadline - Date.now()) / (24 * 3600 * 1000));
    return Math.max(0, diff);
  };

  const translateMsg = (content: string, teamList: any[]) => {
    let t = content.replace(/\b(open|in_progress|waiting_client|resolved|closed|cancelled|low|medium|high|critical)\b/g, (m) => STATUS_PT[m] || m);
    t = t.replace(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi, (uuid) => {
      const member = teamList.find((u:any) => u.id === uuid);
      return member ? (member.name || member.email) : uuid;
    });
    return t;
  };

  const PAGE_LIMIT = 50;

  const mergeMessages = (ticketMsgs: any[], convMsgs: any[]): any[] => {
    const seen = new Set<string>();
    return [...ticketMsgs, ...convMsgs]
      .filter((m:any) => { const k = m.id || `${m.content}-${m.createdAt}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a:any,b:any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  };

  const load = async () => {
    if (!accessToken || !routeTicketRef) return;
    setLoading(true);
    try {
      const ticketUrl = !isUuidTicketRef && client?.id
        ? `${API_BASE}/tickets/by-number/${encodeURIComponent(routeTicketRef)}?clientId=${client.id}`
        : `${API_BASE}/tickets/${routeTicketRef}`;
      const tRes = await portalFetch(ticketUrl, { headers:{ Authorization:`Bearer ${accessToken}` } });
      const tData = await tRes.json();
      const teamData: any[] = [];
      const ticketData = (tRes.ok && (tData?.data || tData)) ? (tData?.data || tData) : null;
      if (!ticketData?.id) {
        setTicket(null);
        setMessages([]);
        setHasMore(false);
        setLoading(false);
        return;
      }
      const mRes = await portalFetch(`${API_BASE}/tickets/${ticketData.id}/messages?includeInternal=false&limit=${PAGE_LIMIT}`, { headers:{ Authorization:`Bearer ${accessToken}` } });
      const mData = await mRes.json();
      // Suporte a resposta paginada ({ messages, hasMore }) e array simples
      const rawTicketMsgs = (mData?.messages ?? mData?.data ?? mData ?? []).filter((m:any) => m.messageType !== 'internal');
      setHasMore(mData?.hasMore ?? false);
      let convMsgs: any[] = [];

      if (ticketData?.conversationId) {
        try {
          const cRes = await portalFetch(`${API_BASE}/conversations/${ticketData.conversationId}/messages?limit=${PAGE_LIMIT}`, { headers:{ Authorization:`Bearer ${accessToken}` } });
          const cData = await cRes.json();
          convMsgs = Array.isArray(cData?.messages) ? cData.messages : Array.isArray(cData?.data) ? cData.data : Array.isArray(cData) ? cData : [];
        } catch {}
      }

      setTicket(ticketData);
      setTeam(teamData?.data || teamData || []);
      setMessages(mergeMessages(rawTicketMsgs, convMsgs));
    } catch {}
    setLoading(false);
  };

  const loadMore = async () => {
    if (!accessToken || !apiTicketId || loadingMore || !hasMore) return;
    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    setLoadingMore(true);
    try {
      // O cursor é a mensagem mais antiga que temos
      const oldest = messages.find((m:any) => m.messageType !== 'internal' && !['system','status_change','assignment','escalation'].includes(m.messageType));
      const cursorId = oldest?.id;
      const url = `${API_BASE}/tickets/${apiTicketId}/messages?includeInternal=false&limit=${PAGE_LIMIT}${cursorId ? `&before=${cursorId}` : ''}`;
      const res = await portalFetch(url, { headers:{ Authorization:`Bearer ${accessToken}` } });
      const data = await res.json();
      const older = (data?.messages ?? data?.data ?? data ?? []).filter((m:any) => m.messageType !== 'internal');
      setHasMore(data?.hasMore ?? false);
      if (older.length > 0) {
        setMessages(prev => mergeMessages(older, prev));
        // Restaurar posição de scroll para não pular para o topo
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop = container.scrollHeight - prevScrollHeight;
          }
        });
      }
    } catch {}
    setLoadingMore(false);
  };

  useEffect(() => { load(); }, [routeTicketRef, accessToken, client?.id]);

  useEffect(() => {
    const toRevoke = { ...msgMediaUrlsRef.current };
    setMsgMediaUrls({});
    msgMediaInFlightRef.current.clear();
    Object.values(toRevoke).forEach((u) => URL.revokeObjectURL(u));
  }, [routeTicketRef]);

  useEffect(() => {
    if (!accessToken || messages.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const m of messages) {
        if (!m?.id) continue;
        if (!(m.hasMedia || m.mediaKind === 'image' || m.mediaKind === 'audio')) continue;
        if (msgMediaUrlsRef.current[m.id] || msgMediaInFlightRef.current.has(String(m.id))) continue;
        msgMediaInFlightRef.current.add(String(m.id));
        try {
          const res = await portalFetch(`${API_BASE}/conversations/messages/${m.id}/media`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) throw new Error('media');
          const blob = await res.blob();
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          setMsgMediaUrls((prev) => {
            if (prev[m.id]) {
              URL.revokeObjectURL(url);
              return prev;
            }
            return { ...prev, [m.id]: url };
          });
        } catch {
          /* id de ticket_messages ou sem ficheiro */
        } finally {
          msgMediaInFlightRef.current.delete(String(m.id));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, accessToken]);

  // ── realtime: append new messages without full reload ──
  useRealtimeTicket(ticket?.id || null, (msg: any) => {
    if (!msg) return;
    setMessages(prev => {
      const exists = prev.some((x: any) => String(x.id) === String(msg.id));
      if (exists) return prev.map((x: any) => String(x.id) === String(msg.id) ? { ...x, ...msg } : x);
      return [...prev, msg];
    });
  });

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !apiTicketId) return;
    setSending(true);
    try {
      await portalFetch(`${API_BASE}/tickets/${apiTicketId}/messages`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${accessToken}` },
        body: JSON.stringify({ content:message, messageType:'comment', channel:'portal' }),
      });
      setMessage(''); load();
    } catch {}
    setSending(false);
  };

  const submitSatisfaction = async (score: 'approved' | 'rejected') => {
    if (satisfying || !apiTicketId) return;
    setSatisfying(true);
    try {
      await portalFetch(`${API_BASE}/tickets/${apiTicketId}/satisfaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ score }),
      });
      await load();
    } catch {}
    setSatisfying(false);
  };

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:300, color:'#94A3B8' }}>
      <div style={{ width:24, height:24, border:'2px solid #6366F1', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.6s linear infinite' }} />
    </div>
  );

  if (!ticket) return (
    <div style={{ textAlign:'center', padding:60, color:'#94A3B8' }}>
      <p>Ticket não encontrado</p>
      <Link href="/portal/dashboard/tickets" style={{ color:'#4F46E5', textDecoration:'none', fontSize:13 }}>← Voltar</Link>
    </div>
  );

  const s = STATUS_STYLE[ticket.status]||{ bg:'#F1F5F9', color:'#475569', dot:'#94A3B8' };
  const isFinished = ['resolved','closed','cancelled'].includes(ticket.status);
  const isResolved = ticket.status === 'resolved';
  const hasSatisfaction = !!ticket.satisfactionScore;
  const autoCloseDays = isResolved && !hasSatisfaction ? daysUntilAutoClose(ticket.resolvedAt) : null;

  return (
    <div style={{ maxWidth:800 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:20 }}>
        <Link href="/portal/dashboard/tickets" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:36, height:36, background:'#fff', border:'1.5px solid #E2E8F0', borderRadius:10, color:'#475569', textDecoration:'none', flexShrink:0, marginTop:2 }}>
          <ArrowLeft style={{ width:16, height:16 }} />
        </Link>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
            <span style={{ fontFamily:'monospace', fontSize:12, fontWeight:700, color:'#4F46E5', background:'#EEF2FF', padding:'3px 8px', borderRadius:6 }}>{ticket.ticketNumber}</span>
            <span style={{ background:s.bg, color:s.color, padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700, display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:s.dot, display:'inline-block' }} />
              {STATUS_LABELS[ticket.status]||ticket.status}
            </span>
            <span style={{ fontSize:11, color:'#94A3B8' }}>{PRIORITY_LABELS[ticket.priority]||ticket.priority}</span>
          </div>
          <h1 style={{ color:'#0F172A', fontSize:18, fontWeight:800, margin:0 }}>{ticket.subject}</h1>
          {ticket.description && <p style={{ color:'#64748B', fontSize:13, margin:'6px 0 0' }}>{ticket.description}</p>}
        </div>
      </div>

      {/* Satisfaction Survey */}
      {isResolved && !hasSatisfaction && (
        <div style={{ background:'#FFFBEB', border:'1.5px solid #FCD34D', borderRadius:12, padding:'16px 20px', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'flex-start', gap:16, flexWrap:'wrap' }}>
            <div style={{ flex:1 }}>
              <p style={{ margin:0, fontSize:14, fontWeight:700, color:'#92400E' }}>
                O agente marcou este chamado como <strong>resolvido</strong>.
              </p>
              <p style={{ margin:'4px 0 0', fontSize:13, color:'#B45309' }}>
                Por favor, confirme se o problema foi solucionado.
                {autoCloseDays !== null && (
                  autoCloseDays > 0
                    ? <> Sem resposta, o chamado será encerrado automaticamente em <strong>{autoCloseDays} dia{autoCloseDays !== 1 ? 's' : ''}</strong>.</>
                    : <> O prazo de confirmação expirou e o chamado será encerrado em breve.</>
                )}
              </p>
            </div>
            <div style={{ display:'flex', gap:8, flexShrink:0 }}>
              <button
                onClick={() => submitSatisfaction('approved')}
                disabled={satisfying}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', background:'#16A34A', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', opacity:satisfying?0.6:1 }}
              >
                <ThumbsUp style={{ width:15, height:15 }} /> Sim, resolvido
              </button>
              <button
                onClick={() => submitSatisfaction('rejected')}
                disabled={satisfying}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', background:'#DC2626', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', opacity:satisfying?0.6:1 }}
              >
                <ThumbsDown style={{ width:15, height:15 }} /> Não, reabrir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Satisfaction Result */}
      {hasSatisfaction && (
        <div style={{
          background: ticket.satisfactionScore === 'approved' ? '#F0FDF4' : '#FEF2F2',
          border: `1.5px solid ${ticket.satisfactionScore === 'approved' ? '#86EFAC' : '#FCA5A5'}`,
          borderRadius:12, padding:'14px 20px', marginBottom:16,
          display:'flex', alignItems:'center', gap:12,
        }}>
          {ticket.satisfactionScore === 'approved'
            ? <CheckCircle style={{ width:20, height:20, color:'#16A34A', flexShrink:0 }} />
            : <XCircle style={{ width:20, height:20, color:'#DC2626', flexShrink:0 }} />
          }
          <p style={{ margin:0, fontSize:13, color: ticket.satisfactionScore === 'approved' ? '#15803D' : '#DC2626', fontWeight:600 }}>
            {ticket.satisfactionScore === 'approved'
              ? 'Você confirmou que a solução foi aceita. Chamado encerrado.'
              : 'Você indicou que o problema não foi resolvido. Chamado reaberto para atendimento.'}
          </p>
        </div>
      )}

      {/* Mensagens (histórico unificado: interações + conversa atendimento) */}
      <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, marginBottom:16, overflow:'hidden' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #F1F5F9', background:'#FAFBFC', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <p style={{ fontSize:12, fontWeight:700, color:'#94A3B8', letterSpacing:'0.08em', textTransform:'uppercase', margin:0 }}>Histórico</p>
          <span style={{ fontSize:12, color:'#64748B', fontWeight:600, marginLeft:'auto' }}>Visualizar:</span>
          <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color:'#475569', fontWeight:500 }}>
            <input type="checkbox" checked={showClient} onChange={(e)=>setShowClient(e.target.checked)} style={{ width:14, height:14, accentColor:'#0D9488' }} />
            <User style={{ width:14, height:14, color:'#0D9488' }} /> Cliente
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color:'#475569', fontWeight:500 }}>
            <input type="checkbox" checked={showAgent} onChange={(e)=>setShowAgent(e.target.checked)} style={{ width:14, height:14, accentColor:'#4F46E5' }} />
            <Headphones style={{ width:14, height:14, color:'#4F46E5' }} /> Agente
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color:'#475569', fontWeight:500 }}>
            <input type="checkbox" checked={showUpdates} onChange={(e)=>setShowUpdates(e.target.checked)} style={{ width:14, height:14, accentColor:'#64748B' }} />
            <RefreshCw style={{ width:14, height:14, color:'#64748B' }} /> Atualizações
          </label>
        </div>
        <div ref={messagesContainerRef} style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:12, maxHeight:520, overflowY:'auto' }}>
          {/* Botão "Carregar mensagens anteriores" */}
          {hasMore && (
            <div style={{ textAlign:'center', paddingBottom:8 }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 16px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:20, color:'#475569', fontSize:12, fontWeight:600, cursor:loadingMore?'wait':'pointer', opacity:loadingMore?0.6:1 }}
              >
                <ChevronUp style={{ width:13, height:13 }} />
                {loadingMore ? 'Carregando...' : 'Carregar mensagens anteriores'}
              </button>
            </div>
          )}
          {messages.length===0 ? (
            <div style={{ textAlign:'center', padding:'32px 0', color:'#94A3B8', fontSize:13 }}>
              <MessageSquare style={{ width:28, height:28, margin:'0 auto 8px', opacity:0.5, display:'block' }} />
              Nenhuma mensagem ainda
            </div>
          ) : (()=>{
            const isUpdate = (m:any)=>['system','status_change','assignment','escalation'].includes(m.messageType);
            const isClient = (m:any)=>m.authorType==='contact' || m.author_type==='contact';
            const filtered = messages
              .filter((m:any)=>{
                if (isUpdate(m)) return showUpdates;
                if (isClient(m)) return showClient;
                return showAgent;
              })
              .sort((a:any,b:any)=>new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime());
            if (filtered.length===0)
              return (
                <div style={{ textAlign:'center', padding:'32px 0', color:'#94A3B8', fontSize:13 }}>
                  <MessageSquare style={{ width:28, height:28, margin:'0 auto 8px', opacity:0.5, display:'block' }} />
                  Nenhuma mensagem com os filtros atuais.
                </div>
              );
            const mainMessages = filtered.filter((m:any) => !isUpdate(m));
            const total = mainMessages.length;
            return filtered.map((m:any)=>{
              const isUp = isUpdate(m);
              const isCl = isClient(m);
              const timeStr = new Date(m.createdAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
              const ini = m.authorName?.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()||'?';
              const isMe = m.authorName === contact?.name;
              const isWhatsappMsg = m.channel === 'whatsapp';
              const mediaSrc = msgMediaUrls[m.id];
              const hideMediaPlaceholder =
                !!mediaSrc && (m.content === '📷 Imagem' || m.content === '🎤 Áudio');
              const showMediaCaption = !!(m.content && !hideMediaPlaceholder);
              const hasConvMedia =
                !!(m.hasMedia || m.mediaKind === 'image' || m.mediaKind === 'audio') &&
                (m.mediaKind === 'image' || m.mediaKind === 'audio');
              const convMediaLoading = hasConvMedia && !mediaSrc;
              const msgIndex = mainMessages.findIndex((x:any) => x.id === m.id);
              const msgNum = msgIndex >= 0 ? total - msgIndex : null;

              if (isUp) {
                const Icon = m.messageType==='escalation'?AlertTriangle:m.messageType==='assignment'?UserCircle:RefreshCw;
                return (
                  <div key={m.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderLeft:'3px solid #94A3B8', background:'#F8FAFC', borderRadius:8, marginLeft:20 }}>
                    <Icon style={{ width:14, height:14, color:'#64748B', flexShrink:0 }} />
                    <div style={{ flex:1 }}>
                      <p style={{ fontSize:12, color:'#64748B', margin:0 }}>{translateMsg(m.content, team)}</p>
                      <span style={{ fontSize:10, color:'#CBD5E1' }}>{timeStr}</span>
                    </div>
                  </div>
                );
              }
              if (isCl) {
                return (
                  <div key={m.id} style={{ display:'flex', gap:10, flexDirection:isMe?'row-reverse':'row', alignItems:'flex-start' }}>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, flexShrink:0 }}>
                      <div style={{ width:32, height:32, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', background:'#CCFBF1', border:'1.5px solid #5EEAD4', color:'#0D9488' }}>
                        <User style={{ width:16, height:16 }} />
                      </div>
                      {msgNum !== null && <span style={{ fontSize:9, fontWeight:700, color:'#94A3B8' }}>{msgNum}</span>}
                    </div>
                    <div style={{ maxWidth:'75%', background:'#CCFBF1', border:'1.5px solid #99F6E4', borderRadius:isMe?'12px 0 12px 12px':'0 12px 12px 12px', padding:'10px 14px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                        <span style={{ fontSize:12, fontWeight:700, color:'#0F766E' }}>{m.authorName}</span>
                        {isWhatsappMsg && <span style={{ fontSize:9, background:'#99F6E4', color:'#0D9488', padding:'2px 6px', borderRadius:20 }}>WhatsApp</span>}
                        <span style={{ fontSize:10, color:'#94A3B8', marginLeft:'auto' }}>{timeStr}</span>
                      </div>
                      {m.mediaKind === 'image' && mediaSrc && (
                        <img src={mediaSrc} alt="" style={{ maxWidth:'100%', maxHeight:200, borderRadius:10, display:'block', marginBottom: showMediaCaption ? 8 : 0, objectFit:'cover' }} />
                      )}
                      {m.mediaKind === 'audio' && mediaSrc && (
                        <audio src={mediaSrc} controls style={{ width:'100%', maxWidth:240, minHeight:36, marginBottom: showMediaCaption ? 8 : 0 }} />
                      )}
                      {convMediaLoading && (
                        <span style={{ display:'block', fontSize:11, opacity:0.8, marginBottom:6 }}>A carregar…</span>
                      )}
                      {showMediaCaption && (
                        <p style={{ fontSize:13, color:'#134E4A', margin:0, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{translateMsg(m.content, team)}</p>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <div key={m.id} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, flexShrink:0 }}>
                    <div style={{ width:32, height:32, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#6366F1,#4F46E5)', color:'#fff', fontSize:10, fontWeight:700 }}>
                      {ini}
                    </div>
                    {msgNum !== null && <span style={{ fontSize:9, fontWeight:700, color:'#94A3B8' }}>{msgNum}</span>}
                  </div>
                  <div style={{ maxWidth:'75%', background:'#EEF2FF', border:'1.5px solid #C7D2FE', borderRadius:'0 12px 12px 12px', padding:'10px 14px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                      <span style={{ fontSize:12, fontWeight:700, color:'#3730A3' }}>{m.authorName}</span>
                      <span style={{ fontSize:9, background:'#C7D2FE', color:'#4F46E5', padding:'2px 6px', borderRadius:20 }}>Agente</span>
                      {isWhatsappMsg && <span style={{ fontSize:9, background:'#CCFBF1', color:'#0F766E', padding:'2px 6px', borderRadius:20 }}>WhatsApp</span>}
                      <span style={{ fontSize:10, color:'#94A3B8', marginLeft:'auto' }}>{timeStr}</span>
                    </div>
                    {m.mediaKind === 'image' && mediaSrc && (
                      <img src={mediaSrc} alt="" style={{ maxWidth:'100%', maxHeight:200, borderRadius:10, display:'block', marginBottom: showMediaCaption ? 8 : 0, objectFit:'cover' }} />
                    )}
                    {m.mediaKind === 'audio' && mediaSrc && (
                      <audio src={mediaSrc} controls style={{ width:'100%', maxWidth:240, minHeight:36, marginBottom: showMediaCaption ? 8 : 0 }} />
                    )}
                    {convMediaLoading && (
                      <span style={{ display:'block', fontSize:11, opacity:0.8, marginBottom:6 }}>A carregar…</span>
                    )}
                    {showMediaCaption && (
                      <p style={{ fontSize:13, color:'#312E81', margin:0, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{translateMsg(m.content, team)}</p>
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Responder */}
      {!isFinished && (
        <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, padding:20 }}>
          <p style={{ fontSize:12, fontWeight:700, color:'#94A3B8', letterSpacing:'0.08em', textTransform:'uppercase', margin:'0 0 12px' }}>Responder</p>
          <form onSubmit={sendMessage}>
            <textarea value={message} onChange={e=>setMessage(e.target.value)} rows={3}
              placeholder="Escreva sua mensagem..."
              onFocus={()=>setFocusMsg(true)} onBlur={()=>setFocusMsg(false)}
              style={{ width:'100%', padding:'12px 14px', background:focusMsg?'#fff':'#F8FAFC', border:`1.5px solid ${focusMsg?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:13, outline:'none', resize:'vertical' as const, boxSizing:'border-box' as const, boxShadow:focusMsg?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' }} />
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:10 }}>
              <button type="submit" disabled={sending||!message.trim()}
                style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 20px', background:'linear-gradient(135deg,#4F46E5,#6366F1)', border:'none', borderRadius:10, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', opacity:(!message.trim()||sending)?0.5:1, boxShadow:'0 4px 14px rgba(99,102,241,0.3)' }}>
                <Send style={{ width:14, height:14 }} /> {sending?'Enviando...':'Enviar'}
              </button>
            </div>
          </form>
        </div>
      )}
      {isFinished && (
        <div style={{ background:'#F8FAFC', border:'1px solid #E2E8F0', borderRadius:12, padding:'14px 20px', textAlign:'center', color:'#94A3B8', fontSize:13 }}>
          Este ticket está {STATUS_LABELS[ticket.status]?.toLowerCase()} e não aceita mais respostas.
        </div>
      )}
    </div>
  );
}
