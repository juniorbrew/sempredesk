'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePortalStore } from '@/store/portal.store';
import { Ticket, Plus, Search, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STATUS_LABELS: Record<string,string> = { open:'Aberto', in_progress:'Em andamento', waiting_client:'Aguardando', resolved:'Resolvido', closed:'Fechado', cancelled:'Cancelado' };
const STATUS_STYLE: Record<string,{ bg:string; color:string; dot:string }> = {
  open:           { bg:'#DBEAFE', color:'#1D4ED8', dot:'#3B82F6' },
  in_progress:    { bg:'#FEF9C3', color:'#854D0E', dot:'#F59E0B' },
  waiting_client: { bg:'#FFEDD5', color:'#C2410C', dot:'#F97316' },
  resolved:       { bg:'#DCFCE7', color:'#15803D', dot:'#10B981' },
  closed:         { bg:'#F1F5F9', color:'#475569', dot:'#94A3B8' },
  cancelled:      { bg:'#FEE2E2', color:'#DC2626', dot:'#EF4444' },
};
const PRIORITY_LABELS: Record<string,string> = { low:'Baixa', medium:'Média', high:'Alta', critical:'Crítica' };
const PRIORITY_STYLE: Record<string,{ bg:string; color:string }> = {
  low:{ bg:'#F1F5F9', color:'#64748B' }, medium:{ bg:'#DBEAFE', color:'#1D4ED8' },
  high:{ bg:'#FFEDD5', color:'#C2410C' }, critical:{ bg:'#FEE2E2', color:'#DC2626' },
};

export default function PortalTicketsPage() {
  const { client, accessToken } = usePortalStore();
  const [tickets, setTickets] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);

  const load = async () => {
    if (!accessToken || !client?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ clientId:client.id, perPage:'20', page:String(page) });
      if (statusFilter) params.append('status', statusFilter);
      if (priorityFilter) params.append('priority', priorityFilter);
      if (search) params.append('search', search);
      const res = await fetch(`/api/v1/tickets?${params}`, { headers:{ Authorization:`Bearer ${accessToken}` } });
      const data = await res.json();
      const inner = data?.data || {};
      setTickets(inner?.data || []);
      setTotal(inner?.total || 0);
      setTotalPages(inner?.totalPages || 1);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [accessToken, client, statusFilter, priorityFilter, page]);
  useEffect(() => { const t = setTimeout(()=>{ setPage(1); load(); }, 400); return ()=>clearTimeout(t); }, [search]);

  // Stats rápidos
  const open = tickets.filter(t=>['open','in_progress','waiting_client'].includes(t.status)).length;

  return (
    <div style={{ maxWidth:900 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ color:'#0F172A', fontSize:22, fontWeight:800, margin:'0 0 4px' }}>Meus Tickets</h1>
          <p style={{ color:'#94A3B8', fontSize:13, margin:0 }}>
            {client?.tradeName || client?.companyName || 'Empresa'} · {total} chamado{total!==1?'s':''} · {open} em aberto
          </p>
        </div>
        <Link href="/portal/dashboard/tickets/new"
          style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 20px', background:'linear-gradient(135deg,#4F46E5,#6366F1)', borderRadius:12, color:'#fff', fontSize:14, fontWeight:700, textDecoration:'none', boxShadow:'0 4px 14px rgba(99,102,241,0.35)' }}>
          <Plus style={{ width:16, height:16 }} /> Novo Ticket
        </Link>
      </div>

      {/* Filtros */}
      <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:14, padding:'14px 16px', marginBottom:20, display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ position:'relative', flex:1, minWidth:200 }}>
          <Search style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', width:14, height:14, color:'#CBD5E1' }} />
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por número ou assunto..."
            style={{ width:'100%', padding:'9px 14px 9px 34px', background:'#F8FAFC', border:'1.5px solid #E2E8F0', borderRadius:9, color:'#0F172A', fontSize:13, outline:'none', boxSizing:'border-box' as const }} />
        </div>
        <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1);}}
          style={{ padding:'9px 14px', background:'#F8FAFC', border:'1.5px solid #E2E8F0', borderRadius:9, color:'#475569', fontSize:13, outline:'none' }}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
        <select value={priorityFilter} onChange={e=>{setPriorityFilter(e.target.value);setPage(1);}}
          style={{ padding:'9px 14px', background:'#F8FAFC', border:'1.5px solid #E2E8F0', borderRadius:9, color:'#475569', fontSize:13, outline:'none' }}>
          <option value="">Todas prioridades</option>
          {Object.entries(PRIORITY_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
        {(statusFilter||priorityFilter||search) && (
          <button onClick={()=>{setStatusFilter('');setPriorityFilter('');setSearch('');setPage(1);}}
            style={{ padding:'8px 12px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:9, color:'#DC2626', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            Limpar filtros
          </button>
        )}
      </div>

      {/* Lista */}
      <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>
            <div style={{ width:24, height:24, border:'2px solid #6366F1', borderTopColor:'transparent', borderRadius:'50%', margin:'0 auto 12px', animation:'spin 0.6s linear infinite' }} />
            Carregando tickets...
          </div>
        ) : tickets.length===0 ? (
          <div style={{ padding:60, textAlign:'center', color:'#94A3B8' }}>
            <Ticket style={{ width:40, height:40, margin:'0 auto 16px', opacity:0.2 }} />
            <p style={{ fontWeight:600, color:'#475569', margin:'0 0 6px' }}>
              {search||statusFilter||priorityFilter ? 'Nenhum ticket encontrado com esses filtros' : 'Nenhum ticket ainda'}
            </p>
            {!search && !statusFilter && !priorityFilter && (
              <Link href="/portal/dashboard/tickets/new"
                style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'9px 18px', background:'linear-gradient(135deg,#4F46E5,#6366F1)', borderRadius:10, color:'#fff', fontSize:13, fontWeight:700, textDecoration:'none', marginTop:12 }}>
                <Plus style={{ width:14, height:14 }} /> Abrir primeiro ticket
              </Link>
            )}
          </div>
        ) : (
          <>
            {tickets.map((t:any, i:number) => {
              const s = STATUS_STYLE[t.status]||{ bg:'#F1F5F9', color:'#475569', dot:'#94A3B8' };
              const p = PRIORITY_STYLE[t.priority]||{ bg:'#F1F5F9', color:'#64748B' };
              const awaitingConfirmation = t.status === 'resolved' && !t.satisfactionScore;
              return (
                <Link key={t.id} href={`/portal/dashboard/tickets/${encodeURIComponent(t.ticketNumber || t.id)}`} style={{ textDecoration:'none' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:14, padding:'16px 20px', borderBottom: i<tickets.length-1?'1px solid #F8FAFC':'none', transition:'background 0.1s', cursor:'pointer', background: awaitingConfirmation ? '#FFFBEB' : 'transparent' }}
                    onMouseEnter={e=>e.currentTarget.style.background= awaitingConfirmation ? '#FEF3C7' : '#FAFBFC'}
                    onMouseLeave={e=>e.currentTarget.style.background= awaitingConfirmation ? '#FFFBEB' : 'transparent'}>
                    {/* Status dot */}
                    <div style={{ width:10, height:10, borderRadius:'50%', background: awaitingConfirmation ? '#F59E0B' : s.dot, flexShrink:0, boxShadow:`0 0 6px ${awaitingConfirmation ? '#F59E0B' : s.dot}60` }} />
                      <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                        <span style={{ fontFamily:'monospace', fontSize:11, fontWeight:700, color:'#4F46E5', background:'#EEF2FF', padding:'2px 7px', borderRadius:5 }}>{t.ticketNumber}</span>
                        <span style={{ fontSize:14, fontWeight:600, color:'#0F172A', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.subject}</span>
                        {awaitingConfirmation && (
                          <span style={{ fontSize:10, fontWeight:700, color:'#92400E', background:'#FDE68A', padding:'2px 8px', borderRadius:20, flexShrink:0 }}>
                            Aguardando sua confirmação
                          </span>
                        )}
                      </div>
                      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                        {t.department && <span style={{ fontSize:11, color:'#94A3B8' }}>{t.department}{t.category?` › ${t.category}`:''}</span>}
                        <span style={{ fontSize:11, color:'#CBD5E1' }}>
                          {formatDistanceToNow(new Date(t.createdAt), { locale:ptBR, addSuffix:true })}
                        </span>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:8, flexShrink:0, alignItems:'center' }}>
                      <span style={{ background:p.bg, color:p.color, padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>
                        {PRIORITY_LABELS[t.priority]||t.priority}
                      </span>
                      <span style={{ background:s.bg, color:s.color, padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>
                        {STATUS_LABELS[t.status]||t.status}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}

            {/* Paginação */}
            {totalPages > 1 && (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 20px', borderTop:'1px solid #F1F5F9' }}>
                <span style={{ fontSize:13, color:'#94A3B8' }}>Página {page} de {totalPages}</span>
                <div style={{ display:'flex', gap:6 }}>
                  <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                    style={{ padding:'6px 10px', background:'#F8FAFC', border:'1.5px solid #E2E8F0', borderRadius:8, cursor:page===1?'not-allowed':'pointer', color:'#475569', opacity:page===1?0.4:1, display:'flex', alignItems:'center' }}>
                    <ChevronLeft style={{ width:14, height:14 }} />
                  </button>
                  <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
                    style={{ padding:'6px 10px', background:'#F8FAFC', border:'1.5px solid #E2E8F0', borderRadius:8, cursor:page===totalPages?'not-allowed':'pointer', color:'#475569', opacity:page===totalPages?0.4:1, display:'flex', alignItems:'center' }}>
                    <ChevronRight style={{ width:14, height:14 }} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
