'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ArrowLeft, Building2, Ticket, Monitor, Users, TrendingUp, RefreshCw, ExternalLink, CheckCircle } from 'lucide-react';

const STATUS_COLORS: Record<string,{bg:string;color:string}> = {
  open:{bg:'#DBEAFE',color:'#1D4ED8'}, in_progress:{bg:'#FEF9C3',color:'#854D0E'},
  waiting_client:{bg:'#FFEDD5',color:'#C2410C'}, resolved:{bg:'#DCFCE7',color:'#15803D'},
  closed:{bg:'#F1F5F9',color:'#475569'}, cancelled:{bg:'#FEE2E2',color:'#DC2626'},
};

export default function NetworkDashboard() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');

  const [network, setNetwork] = useState<any>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [allTickets, setAllTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [netRes, clientsRes, ticketsRes] = await Promise.all([
        api.getNetwork(id),
        api.getCustomers({ networkId: id, perPage: 200 }),
        api.getTickets({ perPage: 500 }),
      ]);
      setNetwork(netRes);
      const clientList = Array.isArray(clientsRes) ? clientsRes : (clientsRes as any)?.data || [];
      setClients(clientList);
      const ticketList = Array.isArray(ticketsRes) ? ticketsRes : (ticketsRes as any)?.data || [];
      // Filter tickets belonging to network clients
      const clientIds = new Set(clientList.map((c: any) => c.id));
      setAllTickets(ticketList.filter((t: any) => clientIds.has(t.clientId)));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { if (id) load(); }, [id]);

  const openTickets = allTickets.filter(t => ['open','in_progress','waiting_client'].includes(t.status));
  const resolvedThisMonth = allTickets.filter(t => {
    if (t.status !== 'resolved') return false;
    const d = new Date(t.resolvedAt || t.updatedAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const clientTickets = (clientId: string) => allTickets.filter(t => t.clientId === clientId);
  const clientOpenTickets = (clientId: string) => clientTickets(clientId).filter(t => ['open','in_progress','waiting_client'].includes(t.status));

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:300 }}>
      <RefreshCw className="w-6 h-6 animate-spin" style={{ color:'#6366F1' }} />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="btn-secondary" style={{ padding:'8px 10px' }}>
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="page-title">{network?.name || 'Rede'}</h1>
          <p className="page-subtitle">Painel consolidado da rede/franquia</p>
        </div>
        <button onClick={load} className="btn-secondary"><RefreshCw className="w-4 h-4" /> Atualizar</button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Empresas', value:clients.length, icon:Building2, color:'stat-indigo' },
          { label:'Tickets Abertos', value:openTickets.length, icon:Ticket, color:'stat-blue' },
          { label:'Resolvidos no Mês', value:resolvedThisMonth.length, icon:CheckCircle, color:'stat-green' },
          { label:'Total de Tickets', value:allTickets.length, icon:TrendingUp, color:'stat-purple' },
        ].map(({ label, value, icon:Icon, color }) => (
          <div key={label} className={`rounded-2xl p-5 ${color}`}>
            <div className="flex items-center justify-between mb-3">
              <p style={{ color:'rgba(255,255,255,0.8)', fontSize:12, fontWeight:600, textTransform:'uppercase', letterSpacing:1 }}>{label}</p>
              <Icon className="w-5 h-5" style={{ color:'rgba(255,255,255,0.6)' }} />
            </div>
            <p style={{ fontSize:32, fontWeight:800, color:'#fff', lineHeight:1 }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Network Info */}
      {network && (
        <div className="card p-5">
          <h3 style={{ fontSize:15, fontWeight:700, color:'#0F172A', marginBottom:12 }}>Informações da Rede</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              ['Segmento', network.segment || '—'],
              ['Estado', network.state || '—'],
              ['Plano', network.supportPlan || '—'],
              ['Status', network.status || '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <p style={{ fontSize:11, fontWeight:600, color:'#94A3B8', textTransform:'uppercase', letterSpacing:1 }}>{label}</p>
                <p style={{ fontSize:14, fontWeight:600, color:'#0F172A', marginTop:2 }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clients Table */}
      <div className="card">
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <h3 style={{ fontSize:15, fontWeight:700, color:'#0F172A' }}>Empresas da Rede ({clients.length})</h3>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                {['Empresa','Cidade/UF','Plano','Tickets Abertos','Total Tickets','Ação'].map(h => (
                  <th key={h} className="table-header" style={{ padding:'10px 16px', textAlign:'left', borderBottom:'2px solid #F1F5F9', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr><td colSpan={6} style={{ padding:40, textAlign:'center', color:'#94A3B8', fontSize:13 }}>Nenhuma empresa nesta rede</td></tr>
              ) : clients.map((c: any) => {
                const open = clientOpenTickets(c.id).length;
                const total = clientTickets(c.id).length;
                return (
                  <tr key={c.id} style={{ borderBottom:'1px solid #F8FAFC' }}>
                    <td style={{ padding:'12px 16px' }}>
                      <div>
                        <p style={{ fontSize:13, fontWeight:700, color:'#0F172A' }}>{c.tradeName || c.companyName}</p>
                        {c.tradeName && <p style={{ fontSize:11, color:'#94A3B8' }}>{c.companyName}</p>}
                      </div>
                    </td>
                    <td style={{ padding:'12px 16px', fontSize:13, color:'#475569' }}>
                      {[c.city, c.state].filter(Boolean).join('/') || '—'}
                    </td>
                    <td style={{ padding:'12px 16px' }}>
                      <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, background:'#EEF2FF', color:'#4F46E5' }}>{c.supportPlan || 'básico'}</span>
                    </td>
                    <td style={{ padding:'12px 16px' }}>
                      <span style={{ fontSize:13, fontWeight:700, color: open > 0 ? '#EF4444' : '#10B981' }}>{open}</span>
                    </td>
                    <td style={{ padding:'12px 16px', fontSize:13, color:'#475569' }}>{total}</td>
                    <td style={{ padding:'12px 16px' }}>
                      <button onClick={() => router.push(`/dashboard/customers/${c.id}`)} className="btn-secondary" style={{ padding:'5px 10px', fontSize:12 }}>
                        <ExternalLink className="w-3.5 h-3.5" /> Ver
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent open tickets */}
      {openTickets.length > 0 && (
        <div className="card">
          <div style={{ padding:'16px 20px', borderBottom:'1px solid #F1F5F9' }}>
            <h3 style={{ fontSize:15, fontWeight:700, color:'#0F172A' }}>Tickets Abertos na Rede ({openTickets.length})</h3>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  {['Número','Assunto','Empresa','Status','Prioridade'].map(h => (
                    <th key={h} className="table-header" style={{ padding:'10px 16px', textAlign:'left', borderBottom:'2px solid #F1F5F9' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openTickets.slice(0, 20).map((t: any) => {
                  const sc = STATUS_COLORS[t.status] || {bg:'#F1F5F9',color:'#64748B'};
                  const client = clients.find(c => c.id === t.clientId);
                  return (
                    <tr key={t.id} style={{ borderBottom:'1px solid #F8FAFC', cursor:'pointer' }}
                      onClick={() => router.push(`/dashboard/tickets/${t.id}`)}
                      onMouseEnter={e => (e.currentTarget.style.background='#F8FAFF')}
                      onMouseLeave={e => (e.currentTarget.style.background='')}>
                      <td style={{ padding:'10px 16px', fontFamily:'monospace', fontSize:12, fontWeight:700, color:'#4F46E5' }}>{t.ticketNumber}</td>
                      <td style={{ padding:'10px 16px', fontSize:13, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.subject}</td>
                      <td style={{ padding:'10px 16px', fontSize:12, color:'#475569' }}>{client?.tradeName || client?.companyName || '—'}</td>
                      <td style={{ padding:'10px 16px' }}>
                        <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background:sc.bg, color:sc.color }}>{t.status}</span>
                      </td>
                      <td style={{ padding:'10px 16px' }}>
                        <span className={`badge badge-${t.priority}`}>{t.priority}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
