'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { Download, RefreshCw, TrendingUp, Clock, CheckCircle, AlertTriangle, BarChart2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const PRIORITY_COLORS: Record<string,string> = { low:'#94A3B8', medium:'#3B82F6', high:'#F97316', critical:'#EF4444' };
const STATUS_COLORS: Record<string,string> = { open:'#3B82F6', in_progress:'#F59E0B', waiting_client:'#F97316', resolved:'#10B981', closed:'#94A3B8', cancelled:'#EF4444' };
const STATUS_LABELS: Record<string,string> = { open:'Aberto', in_progress:'Em Andamento', waiting_client:'Aguardando', resolved:'Resolvido', closed:'Fechado', cancelled:'Cancelado' };
const PRIORITY_LABELS: Record<string,string> = { low:'Baixa', medium:'Média', high:'Alta', critical:'Crítica' };

export default function ReportsPage() {
  const [stats, setStats] = useState<any>(null);
  const [team, setTeam] = useState<any[]>([]);
  const [slaRisk, setSlaRisk] = useState<any[]>([]);
  const [trend, setTrend] = useState<any[]>([]);
  const [trendDays, setTrendDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, teamRes, slaRes, trendRes] = await Promise.all([
        api.ticketStats(),
        api.getTeam(),
        api.getTickets({ status: 'open,in_progress', perPage: 50 }),
        (api as any).ticketTrend(trendDays),
      ]);
      setStats(statsRes);
      setTeam(teamRes || []);
      const all: any[] = Array.isArray(slaRes) ? slaRes : (slaRes as any)?.data || [];
      const now = Date.now();
      const in24h = all.filter((t: any) => t.slaResolveAt && new Date(t.slaResolveAt).getTime() - now < 24 * 3600 * 1000);
      setSlaRisk(in24h.sort((a: any, b: any) => new Date(a.slaResolveAt).getTime() - new Date(b.slaResolveAt).getTime()));
      // Process trend data
      const trendData = Array.isArray(trendRes) ? trendRes : (trendRes as any)?.data || [];
      setTrend(trendData.map((d: any) => ({ ...d, label: d.date ? format(new Date(d.date), 'dd/MM', { locale: ptBR }) : d.label })));
    } catch(e) { console.error(e); }
    setLoading(false);
  }, [trendDays]);

  useEffect(() => { load(); }, [load]);

  const byTech = team.map(u => ({
    name: u.name?.split(' ')[0] || u.email?.split('@')[0] || '?',
    tickets: (stats?.byAssignee || []).find((a: any) => a.assignedTo === u.id)?.count || 0,
  })).filter(u => u.tickets > 0).sort((a, b) => b.tickets - a.tickets).slice(0, 10);

  const byStatus = Object.entries(STATUS_LABELS).map(([key, label]) => ({
    name: label,
    value: (stats?.byStatus || []).find((s: any) => s.status === key)?.count || 0,
    fill: STATUS_COLORS[key],
  })).filter(s => s.value > 0);

  const byPriority = Object.entries(PRIORITY_LABELS).map(([key, label]) => ({
    name: label,
    value: (stats?.byPriority || []).find((p: any) => p.priority === key)?.count || 0,
    fill: PRIORITY_COLORS[key],
  })).filter(p => p.value > 0);

  const exportCSV = async () => {
    try {
      const res: any = await api.getTickets({ perPage: 9999 });
      const rows: any[] = Array.isArray(res) ? res : res?.data || [];
      const header = ['Número','Assunto','Cliente','Status','Prioridade','Técnico','SLA Resolução','Aberto em','Resolvido em'];
      const csvRows = rows.map((t: any) => [
        t.ticketNumber, `"${t.subject}"`, `"${t.clientName||''}"`,
        STATUS_LABELS[t.status]||t.status, PRIORITY_LABELS[t.priority]||t.priority,
        `"${t.assigneeName||''}"`,
        t.slaResolveAt ? format(new Date(t.slaResolveAt),'dd/MM/yyyy HH:mm') : '',
        t.createdAt ? format(new Date(t.createdAt),'dd/MM/yyyy HH:mm') : '',
        t.resolvedAt ? format(new Date(t.resolvedAt),'dd/MM/yyyy HH:mm') : '',
      ].join(','));
      const csv = [header.join(','), ...csvRows].join('\n');
      const blob = new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `relatorio-tickets-${format(new Date(),'yyyy-MM-dd')}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  const total = (stats?.byStatus || []).reduce((s: number, r: any) => s + Number(r.count || 0), 0);
  const openCount = (stats?.byStatus || []).find((s: any) => s.status === 'open')?.count || 0;
  const inProgressCount = (stats?.byStatus || []).find((s: any) => s.status === 'in_progress')?.count || 0;
  const resolvedCount = (stats?.byStatus || []).find((s: any) => s.status === 'resolved')?.count || 0;

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:300 }}>
      <RefreshCw className="w-6 h-6 animate-spin" style={{ color:'#6366F1' }} />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Relatórios</h1>
          <p className="page-subtitle">Visão geral e métricas do sistema</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={load} className="btn-secondary"><RefreshCw className="w-4 h-4" /> Atualizar</button>
          <button onClick={exportCSV} className="btn-secondary"><Download className="w-4 h-4" /> Exportar CSV</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Total de Tickets', value:total, icon:BarChart2, color:'stat-indigo' },
          { label:'Em Aberto', value:openCount, icon:TrendingUp, color:'stat-blue' },
          { label:'SLA em Risco', value:slaRisk.length, icon:AlertTriangle, color:'stat-red' },
          { label:'Resolvidos', value:resolvedCount, icon:CheckCircle, color:'stat-green' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className={`rounded-2xl p-5 ${color}`}>
            <div className="flex items-center justify-between mb-3">
              <p style={{ color:'rgba(255,255,255,0.8)', fontSize:12, fontWeight:600, textTransform:'uppercase', letterSpacing:1 }}>{label}</p>
              <Icon className="w-5 h-5" style={{ color:'rgba(255,255,255,0.6)' }} />
            </div>
            <p style={{ fontSize:32, fontWeight:800, color:'#fff', lineHeight:1 }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Trend Chart */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 style={{ fontSize:15, fontWeight:700, color:'#0F172A' }}>Tendência de Tickets</h3>
          <div className="flex gap-1">
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setTrendDays(d)}
                style={{ padding:'5px 12px', borderRadius:8, border:'1.5px solid', fontSize:12, fontWeight:600, cursor:'pointer', background: trendDays===d ? '#4F46E5' : 'transparent', color: trendDays===d ? '#fff' : '#64748B', borderColor: trendDays===d ? '#4F46E5' : '#E2E8F0' }}>
                {d}d
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend} margin={{ top:5, right:10, left:-10, bottom:5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="label" tick={{ fontSize:11, fill:'#94A3B8' }} />
            <YAxis tick={{ fontSize:11, fill:'#94A3B8' }} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius:10, border:'1px solid #E2E8F0', fontSize:12 }} />
            <Legend />
            <Line type="monotone" dataKey="count" name="Tickets criados" stroke="#4F46E5" strokeWidth={2} dot={{ r:3, fill:'#4F46E5' }} activeDot={{ r:5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* By Technician */}
        <div className="card p-5 lg:col-span-1">
          <h3 style={{ fontSize:15, fontWeight:700, color:'#0F172A', marginBottom:16 }}>Por Técnico</h3>
          {byTech.length === 0 ? <p style={{ color:'#94A3B8', fontSize:13, textAlign:'center', padding:'20px 0' }}>Sem dados</p> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byTech} layout="vertical" margin={{ left:0, right:10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize:11, fill:'#94A3B8' }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize:11, fill:'#475569' }} width={60} />
                <Tooltip contentStyle={{ borderRadius:10, border:'1px solid #E2E8F0', fontSize:12 }} />
                <Bar dataKey="tickets" fill="#6366F1" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* By Status */}
        <div className="card p-5">
          <h3 style={{ fontSize:15, fontWeight:700, color:'#0F172A', marginBottom:16 }}>Por Status</h3>
          {byStatus.length === 0 ? <p style={{ color:'#94A3B8', fontSize:13, textAlign:'center', padding:'20px 0' }}>Sem dados</p> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byStatus} margin={{ left:-20, right:10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="name" tick={{ fontSize:10, fill:'#94A3B8' }} />
                <YAxis tick={{ fontSize:11, fill:'#94A3B8' }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius:10, border:'1px solid #E2E8F0', fontSize:12 }} />
                <Bar dataKey="value" name="Tickets" radius={[4,4,0,0]}>
                  {byStatus.map((entry, i) => <rect key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* By Priority */}
        <div className="card p-5">
          <h3 style={{ fontSize:15, fontWeight:700, color:'#0F172A', marginBottom:16 }}>Por Prioridade</h3>
          {byPriority.length === 0 ? <p style={{ color:'#94A3B8', fontSize:13, textAlign:'center', padding:'20px 0' }}>Sem dados</p> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byPriority} margin={{ left:-20, right:10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="name" tick={{ fontSize:11, fill:'#94A3B8' }} />
                <YAxis tick={{ fontSize:11, fill:'#94A3B8' }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius:10, border:'1px solid #E2E8F0', fontSize:12 }} />
                <Bar dataKey="value" name="Tickets" radius={[4,4,0,0]}>
                  {byPriority.map((entry, i) => <rect key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* SLA Risk Table */}
      <div className="card p-5">
        <h3 style={{ fontSize:15, fontWeight:700, color:'#0F172A', marginBottom:16 }}>
          <AlertTriangle className="w-4 h-4 inline mr-2" style={{ color:'#EF4444' }} />
          SLA em Risco (próximas 24h)
        </h3>
        {slaRisk.length === 0 ? (
          <div style={{ textAlign:'center', padding:'24px 0', color:'#10B981' }}>
            <CheckCircle className="w-8 h-8 mx-auto mb-2" style={{ opacity:0.5 }} />
            <p style={{ fontSize:13 }}>Nenhum ticket com SLA em risco</p>
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  {['Número','Assunto','Cliente','Prioridade','SLA Resolução','Tempo Restante'].map(h => (
                    <th key={h} className="table-header" style={{ padding:'8px 12px', textAlign:'left', borderBottom:'2px solid #F1F5F9' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slaRisk.map((t: any) => {
                  const ms = t.slaResolveAt ? new Date(t.slaResolveAt).getTime() - Date.now() : 0;
                  const h = Math.floor(ms / 3600000);
                  const m = Math.floor((ms % 3600000) / 60000);
                  const expired = ms < 0;
                  return (
                    <tr key={t.id} style={{ borderBottom:'1px solid #F8FAFC' }}>
                      <td style={{ padding:'10px 12px', fontFamily:'monospace', fontSize:12, fontWeight:700, color:'#4F46E5' }}>{t.ticketNumber}</td>
                      <td style={{ padding:'10px 12px', fontSize:13, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.subject}</td>
                      <td style={{ padding:'10px 12px', fontSize:13, color:'#475569' }}>{t.clientName||'—'}</td>
                      <td style={{ padding:'10px 12px' }}>
                        <span className={`badge badge-${t.priority}`}>{PRIORITY_LABELS[t.priority]||t.priority}</span>
                      </td>
                      <td style={{ padding:'10px 12px', fontSize:12, color:'#475569' }}>
                        {t.slaResolveAt ? format(new Date(t.slaResolveAt),'dd/MM HH:mm') : '—'}
                      </td>
                      <td style={{ padding:'10px 12px' }}>
                        <span style={{ fontSize:12, fontWeight:700, color: expired ? '#DC2626' : '#D97706', background: expired ? '#FEE2E2' : '#FEF3C7', padding:'2px 8px', borderRadius:20 }}>
                          {expired ? 'Vencido' : `${h}h ${m}m`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
