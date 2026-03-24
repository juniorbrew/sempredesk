'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { usePortalStore } from '@/store/portal.store';
import { ArrowLeft, Send, User, Headphones, RefreshCw, AlertTriangle, UserCircle, MessageSquare, PhoneCall, ThumbsUp, ThumbsDown, CheckCircle, XCircle } from 'lucide-react';

const API_BASE = '/api/v1';

const STATUS_LABELS: Record<string,string> = { open:'Aberto', in_progress:'Em andamento', waiting_client:'Aguardando', resolved:'Resolvido', closed:'Fechado', cancelled:'Cancelado' };
const STATUS_STYLE: Record<string,{ bg:string; color:string; dot:string }> = {
  open:{ bg:'#DBEAFE', color:'#1D4ED8', dot:'#3B82F6' }, in_progress:{ bg:'#FEF9C3', color:'#854D0E', dot:'#F59E0B' },
  waiting_client:{ bg:'#FFEDD5', color:'#C2410C', dot:'#F97316' }, resolved:{ bg:'#DCFCE7', color:'#15803D', dot:'#10B981' },
  closed:{ bg:'#F1F5F9', color:'#475569', dot:'#94A3B8' }, cancelled:{ bg:'#FEE2E2', color:'#DC2626', dot:'#EF4444' },
};
const PRIORITY_LABELS: Record<string,string> = { low:'Baixa', medium:'Média', high:'Alta', critical:'Crítica' };

export default function PortalTicketDetailPage() {
  const { id } = useParams();
  const { accessToken, contact } = usePortalStore();
  const [ticket, setTicket] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [focusMsg, setFocusMsg] = useState(false);
  const [showClient, setShowClient] = useState(true);
  const [showAgent, setShowAgent] = useState(true);
  const [showUpdates, setShowUpdates] = useState(true);
  const [satisfying, setSatisfying] = useState(false);
  const [csatSent, setCsatSent] = useState(false);

  const STATUS_PT: Record<string,string> = { open:'Aberto', in_progress:'Em Andamento', waiting_client:'Aguardando Cliente', resolved:'Resolvido', closed:'Fechado', cancelled:'Cancelado' };
  const translateMsg = (content: string) => content.replace(/\b(open|in_progress|waiting_client|resolved|closed|cancelled)\b/g, (m) => STATUS_PT[m] || m);

  const load = async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    try {
      const [tRes, mRes] = await Promise.all([
        fetch(`${API_BASE}/tickets/${id}`, { headers:{ Authorization:`Bearer ${accessToken}` } }),
        fetch(`${API_BASE}/tickets/${id}/messages?includeInternal=false`, { headers:{ Authorization:`Bearer ${accessToken}` } }),
      ]);
      const tData = await tRes.json();
      const mData = await mRes.json();
      const ticketData = (tRes.ok && (tData?.data || tData)) ? (tData?.data || tData) : null;
      const rawTicketMsgs = (mData?.data || mData || []).filter((m:any) => m.messageType !== 'internal');
      let convMsgs: any[] = [];

      if (ticketData?.conversationId) {
        try {
          const cRes = await fetch(`${API_BASE}/conversations/${ticketData.conversationId}/messages`, { headers:{ Authorization:`Bearer ${accessToken}` } });
          const cData = await cRes.json();
          convMsgs = Array.isArray(cData?.data) ? cData.data : Array.isArray(cData) ? cData : [];
        } catch {}
      }

      const seen = new Set<string>();
      const merged = [...rawTicketMsgs, ...convMsgs]
        .filter((m:any) => { const k = m.id || `${m.content}-${m.createdAt}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a:any,b:any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      setTicket(ticketData);
      setMessages(merged);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [id, accessToken]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      await fetch(`${API_BASE}/tickets/${id}/messages`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${accessToken}` },
        body: JSON.stringify({ content:message, messageType:'comment' }),
      });
      setMessage(''); load();
    } catch {}
    setSending(false);
  };

  const submitSatisfaction = async (score: 'approved' | 'rejected') => {
    if (satisfying) return;
    setSatisfying(true);
    try {
      await fetch(`${API_BASE}/tickets/${id}/satisfaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ score }),
      });
      await load();
    } catch {}
    setSatisfying(false);
  };

  const submitCsat = async (score: 'approved' | 'rejected') => {
    try {
      await fetch(`${API_BASE}/tickets/${id}/satisfaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ score }),
      });
      setCsatSent(true);
      setTicket((prev: any) => ({ ...prev, satisfactionScore: score }));
    } catch {}
  };

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:300, color:'#94A3B8' }}>
      <div style={{ width:24, height:24, border:'2px solid #6366F1', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.6s linear infinite' }} />
    </div>
  );

  if (!ticket) return (
    <div style={{ textAlign:'center', padding:60, color:'#94A3B8' }}>
      <p>Ticket não encontrado</p>
      <Link href="/portal/tickets" style={{ color:'#4F46E5', textDecoration:'none', fontSize:13 }}>← Voltar</Link>
    </div>
  );

  const s = STATUS_STYLE[ticket.status]||{ bg:'#F1F5F9', color:'#475569', dot:'#94A3B8' };
  const isFinished = ['resolved','closed','cancelled'].includes(ticket.status);
  const isResolved = ticket.status === 'resolved';
  const hasSatisfaction = !!ticket.satisfactionScore;

  return (
    <div style={{ maxWidth:800 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:20 }}>
        <Link href="/portal/tickets" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:36, height:36, background:'#fff', border:'1.5px solid #E2E8F0', borderRadius:10, color:'#475569', textDecoration:'none', flexShrink:0, marginTop:2 }}>
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
        <div style={{ background:'#F0FDF4', border:'1.5px solid #86EFAC', borderRadius:12, padding:'16px 20px', marginBottom:16, display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontSize:14, fontWeight:700, color:'#15803D' }}>
              Este ticket foi considerado como <strong>resolvido</strong> pelo agente que efetuou o atendimento.
            </p>
            <p style={{ margin:'4px 0 0', fontSize:13, color:'#166534' }}>Você concorda com a solução apresentada?</p>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button
              onClick={() => submitSatisfaction('approved')}
              disabled={satisfying}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', background:'#16A34A', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', opacity:satisfying?0.6:1 }}
            >
              <ThumbsUp style={{ width:15, height:15 }} /> SIM
            </button>
            <button
              onClick={() => submitSatisfaction('rejected')}
              disabled={satisfying}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', background:'#DC2626', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', opacity:satisfying?0.6:1 }}
            >
              <ThumbsDown style={{ width:15, height:15 }} /> NÃO
            </button>
          </div>
        </div>
      )}

      {/* Satisfaction Result */}
      {isResolved && hasSatisfaction && (
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
              ? 'Você confirmou que a solução foi aceita.'
              : 'Você indicou que a solução não foi satisfatória.'}
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
        <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:12 }}>
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

            // Separate main messages and system events for numbering
            const mainMessages = filtered.filter((m:any) => !isUpdate(m));
            const total = mainMessages.length;

            return filtered.map((m:any, idx:number)=>{
              const isUp = isUpdate(m);
              const isCl = isClient(m);
              const timeStr = new Date(m.createdAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
              const ini = m.authorName?.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()||'?';
              const isMe = m.authorName === contact?.name;
              const isWhatsappMsg = m.channel === 'whatsapp';

              // Number for main messages (ascending: 1, 2, 3...)
              const msgIndex = mainMessages.findIndex((x:any) => x.id === m.id);
              const msgNum = msgIndex >= 0 ? total - msgIndex : null;

              if (isUp) {
                const Icon = m.messageType==='escalation'?AlertTriangle:m.messageType==='assignment'?UserCircle:RefreshCw;
                return (
                  <div key={m.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderLeft:'3px solid #94A3B8', background:'#F8FAFC', borderRadius:8, marginLeft:20 }}>
                    <Icon style={{ width:14, height:14, color:'#64748B', flexShrink:0 }} />
                    <div style={{ flex:1 }}>
                      <p style={{ fontSize:12, color:'#64748B', margin:0 }}>{translateMsg(m.content)}</p>
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
                      <p style={{ fontSize:13, color:'#134E4A', margin:0, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{m.content}</p>
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
                    <p style={{ fontSize:13, color:'#312E81', margin:0, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{m.content}</p>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* CSAT Section */}
      {ticket.status === 'resolved' && !ticket.satisfactionScore && (
        <div style={{ background:'linear-gradient(135deg,#EEF2FF,#E0F2FE)', borderRadius:16, padding:24, border:'1.5px solid #C7D2FE', textAlign:'center', marginTop:16 }}>
          <CheckCircle style={{ width:32, height:32, color:'#10B981', margin:'0 auto 12px' }} />
          <h3 style={{ fontSize:16, fontWeight:700, color:'#0F172A', margin:'0 0 6px' }}>Seu ticket foi resolvido!</h3>
          <p style={{ fontSize:13, color:'#64748B', marginBottom:20 }}>Como foi o atendimento? Sua avaliação nos ajuda a melhorar.</p>
          {!csatSent ? (
            <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' }}>
              <button onClick={() => submitCsat('approved')}
                style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 24px', borderRadius:12, border:'none', cursor:'pointer', background:'#10B981', color:'#fff', fontWeight:700, fontSize:14 }}>
                👍 Ótimo atendimento
              </button>
              <button onClick={() => submitCsat('rejected')}
                style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 24px', borderRadius:12, border:'none', cursor:'pointer', background:'#EF4444', color:'#fff', fontWeight:700, fontSize:14 }}>
                👎 Precisa melhorar
              </button>
            </div>
          ) : (
            <p style={{ fontSize:14, fontWeight:700, color:'#10B981' }}>✅ Obrigado pela sua avaliação!</p>
          )}
        </div>
      )}
      {ticket.status === 'resolved' && ticket.satisfactionScore && (
        <div style={{ background:'#DCFCE7', borderRadius:12, padding:16, border:'1.5px solid #86EFAC', textAlign:'center', marginTop:16 }}>
          <p style={{ fontSize:13, fontWeight:600, color:'#166534' }}>
            {ticket.satisfactionScore === 'approved' ? '👍 Você avaliou este atendimento como ótimo' : '👎 Você indicou que o atendimento precisa melhorar'}
          </p>
        </div>
      )}

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
