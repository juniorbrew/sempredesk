'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePortalStore } from '@/store/portal.store';
import { Ticket, FileText, Clock, CheckCircle, AlertTriangle, Plus, ArrowRight, Bell } from 'lucide-react';

export default function PortalHomePage() {
  const { contact, client, accessToken, activeCompanyId } = usePortalStore();
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const companyId = activeCompanyId || client?.id || null;

  const load = async (scopeCompanyId = companyId, signal?: AbortSignal) => {
    if (!accessToken || !scopeCompanyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/tickets?clientId=${scopeCompanyId}&perPage=5`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      const data = await res.json();
      setTickets(data?.data?.data || data?.data || []);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    setTickets([]);
    if (!accessToken || !companyId) {
      setLoading(false);
      return () => ac.abort();
    }
    setLoading(true);
    void load(companyId, ac.signal);
    return () => ac.abort();
  }, [accessToken, companyId]);

  const open = tickets.filter(t => ['open','in_progress','waiting_client'].includes(t.status)).length;
  const resolved = tickets.filter(t => t.status === 'resolved').length;
  // Tickets aguardando confirmação de resolução (sem avaliação ainda)
  const pendingConfirmation = tickets.filter(t => t.status === 'resolved' && !t.satisfactionScore);

  const STATUS_LABELS: Record<string,string> = { open:'Aberto', in_progress:'Em andamento', waiting_client:'Aguardando', resolved:'Resolvido', closed:'Fechado', cancelled:'Cancelado' };
  const STATUS_STYLE: Record<string,{ bg:string; color:string }> = {
    open:{ bg:'#DBEAFE', color:'#1D4ED8' }, in_progress:{ bg:'#FEF9C3', color:'#854D0E' },
    waiting_client:{ bg:'#FFEDD5', color:'#C2410C' }, resolved:{ bg:'#DCFCE7', color:'#15803D' },
    closed:{ bg:'#F1F5F9', color:'#475569' }, cancelled:{ bg:'#FEE2E2', color:'#DC2626' },
  };

  return (
    <div style={{ maxWidth:900 }}>
      {/* Header */}
      <div style={{ marginBottom:28 }}>
        <h1 style={{ color:'#0F172A', fontSize:24, fontWeight:800, margin:'0 0 4px' }}>
          Olá, {contact?.name?.split(' ')[0] || 'Cliente'}! 👋
        </h1>
        <p style={{ color:'#94A3B8', fontSize:14, margin:0 }}>{client?.tradeName||client?.companyName}</p>
      </div>

      {/* Notificação: tickets aguardando confirmação */}
      {pendingConfirmation.length > 0 && (
        <div style={{ background:'#FFFBEB', border:'1.5px solid #FCD34D', borderRadius:14, padding:'14px 18px', marginBottom:20, display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ width:40, height:40, borderRadius:12, background:'#FEF3C7', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <Bell style={{ width:20, height:20, color:'#D97706' }} />
          </div>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontSize:14, fontWeight:700, color:'#92400E' }}>
              {pendingConfirmation.length === 1
                ? '1 chamado aguarda sua confirmação'
                : `${pendingConfirmation.length} chamados aguardam sua confirmação`}
            </p>
            <p style={{ margin:'3px 0 0', fontSize:12, color:'#B45309' }}>
              O suporte marcou {pendingConfirmation.length === 1 ? 'um chamado' : 'chamados'} como resolvido. Confirme se o problema foi solucionado.
            </p>
          </div>
          <Link href="/portal/tickets?status=resolved" style={{ flexShrink:0, padding:'8px 14px', background:'#D97706', border:'none', borderRadius:8, color:'#fff', fontSize:12, fontWeight:700, textDecoration:'none', display:'flex', alignItems:'center', gap:4 }}>
            Ver <ArrowRight style={{ width:13, height:13 }} />
          </Link>
        </div>
      )}

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:28 }}>
        {[
          { label:'Tickets Abertos', value:open, icon:Ticket, gradient:'linear-gradient(135deg,#6366F1,#4F46E5)', shadow:'rgba(99,102,241,0.35)' },
          { label:'Resolvidos', value:resolved, icon:CheckCircle, gradient:'linear-gradient(135deg,#10B981,#059669)', shadow:'rgba(16,185,129,0.3)' },
          { label:'Total', value:tickets.length, icon:Clock, gradient:'linear-gradient(135deg,#F59E0B,#D97706)', shadow:'rgba(245,158,11,0.3)' },
        ].map(({ label, value, icon:Icon, gradient, shadow }) => (
          <div key={label} style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, padding:20, display:'flex', alignItems:'center', gap:14, boxShadow:'0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ width:48, height:48, borderRadius:14, background:gradient, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:`0 4px 14px ${shadow}` }}>
              <Icon style={{ width:24, height:24, color:'#fff' }} />
            </div>
            <div>
              <p style={{ fontSize:28, fontWeight:800, color:'#0F172A', margin:0, lineHeight:1 }}>{value}</p>
              <p style={{ fontSize:13, color:'#94A3B8', margin:'4px 0 0' }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Ações rápidas */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:28 }}>
        <Link href="/portal/tickets/new" style={{ textDecoration:'none' }}>
          <div style={{ background:'linear-gradient(135deg,#4F46E5,#6366F1)', borderRadius:16, padding:'20px 24px', display:'flex', alignItems:'center', gap:14, cursor:'pointer', boxShadow:'0 4px 20px rgba(99,102,241,0.35)', transition:'transform 0.2s' }}
            onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'}
            onMouseLeave={e=>e.currentTarget.style.transform='none'}>
            <div style={{ width:44, height:44, borderRadius:12, background:'rgba(255,255,255,0.2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Plus style={{ width:22, height:22, color:'#fff' }} />
            </div>
            <div>
              <p style={{ color:'#fff', fontWeight:700, fontSize:15, margin:0 }}>Abrir Novo Ticket</p>
              <p style={{ color:'rgba(255,255,255,0.7)', fontSize:12, margin:'3px 0 0' }}>Registre um novo chamado</p>
            </div>
            <ArrowRight style={{ width:18, height:18, color:'rgba(255,255,255,0.6)', marginLeft:'auto' }} />
          </div>
        </Link>
        <Link href="/portal/knowledge" style={{ textDecoration:'none' }}>
          <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, padding:'20px 24px', display:'flex', alignItems:'center', gap:14, cursor:'pointer', boxShadow:'0 1px 3px rgba(0,0,0,0.06)', transition:'all 0.2s' }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor='#C7D2FE'; e.currentTarget.style.transform='translateY(-2px)'; }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor='#E2E8F0'; e.currentTarget.style.transform='none'; }}>
            <div style={{ width:44, height:44, borderRadius:12, background:'#EEF2FF', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <FileText style={{ width:22, height:22, color:'#4F46E5' }} />
            </div>
            <div>
              <p style={{ color:'#0F172A', fontWeight:700, fontSize:15, margin:0 }}>Base de Conhecimento</p>
              <p style={{ color:'#94A3B8', fontSize:12, margin:'3px 0 0' }}>Encontre soluções rápidas</p>
            </div>
            <ArrowRight style={{ width:18, height:18, color:'#CBD5E1', marginLeft:'auto' }} />
          </div>
        </Link>
      </div>

      {/* Tickets recentes */}
      <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <h2 style={{ fontSize:14, fontWeight:700, color:'#0F172A', margin:0 }}>Tickets Recentes</h2>
          <Link href="/portal/tickets" style={{ fontSize:12, color:'#4F46E5', fontWeight:600, textDecoration:'none', display:'flex', alignItems:'center', gap:4 }}>
            Ver todos <ArrowRight style={{ width:13, height:13 }} />
          </Link>
        </div>
        {loading ? (
          <div style={{ padding:32, textAlign:'center', color:'#94A3B8', fontSize:13 }}>Carregando...</div>
        ) : tickets.length === 0 ? (
          <div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>
            <Ticket style={{ width:32, height:32, margin:'0 auto 12px', opacity:0.2 }} />
            <p style={{ margin:0, fontSize:13 }}>Nenhum ticket encontrado</p>
          </div>
        ) : tickets.slice(0,5).map((t:any) => {
          const s = STATUS_STYLE[t.status]||{ bg:'#F1F5F9', color:'#475569' };
          return (
            <Link key={t.id} href={`/portal/tickets/${t.id}`} style={{ textDecoration:'none' }}>
              <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 20px', borderBottom:'1px solid #F8FAFC', transition:'background 0.1s', cursor:'pointer' }}
                onMouseEnter={e=>e.currentTarget.style.background='#FAFBFC'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                    <span style={{ fontFamily:'monospace', fontSize:11, fontWeight:700, color:'#4F46E5', background:'#EEF2FF', padding:'1px 6px', borderRadius:5 }}>{t.ticketNumber}</span>
                    <span style={{ fontSize:13, fontWeight:500, color:'#0F172A', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.subject}</span>
                  </div>
                  <p style={{ fontSize:11, color:'#94A3B8', margin:0 }}>{new Date(t.createdAt).toLocaleDateString('pt-BR')}</p>
                </div>
                <span style={{ background:s.bg, color:s.color, padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700, whiteSpace:'nowrap', flexShrink:0 }}>
                  {STATUS_LABELS[t.status]||t.status}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
