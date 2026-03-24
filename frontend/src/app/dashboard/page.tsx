'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Ticket, Monitor, CheckCircle, Clock, AlertTriangle, RefreshCw, TrendingUp, Activity } from 'lucide-react';

const PRIORITY_COLORS: Record<string,string> = { low:'#94A3B8', medium:'#3B82F6', high:'#F59E0B', critical:'#EF4444' };
const PRIORITY_LABELS: Record<string,string> = { low:'Baixa', medium:'Média', high:'Alta', critical:'Crítica' };

function StatCard({ icon: Icon, label, value, gradient, sub }: any) {
  return (
    <div className="card p-5 flex items-center gap-4 animate-fade-up">
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${gradient}`}
        style={{ boxShadow: '0 4px 14px rgba(0,0,0,0.15)' }}>
        <Icon className="w-7 h-7 text-white" />
      </div>
      <div>
        <p className="text-sm font-medium" style={{ color:'#94A3B8' }}>{label}</p>
        <p className="text-3xl font-extrabold mt-0.5" style={{ color:'#0F172A' }}>{value ?? '—'}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color:'#94A3B8' }}>{sub}</p>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [byPriority, setByPriority] = useState<any[]>([]);
  const [sla, setSla] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [s,t,p,sl] = await Promise.all([
        api.dashboardSummary() as any,
        api.dashboardTrend(7) as any,
        api.dashboardByPriority() as any,
        api.slaReport() as any,
      ]);
      setSummary(s); setTrend(t); setByPriority(p); setSla(sl);
    } catch(e){ console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const slaColor = summary?.slaCompliance >= 90 ? '#10B981' : summary?.slaCompliance >= 70 ? '#F59E0B' : '#EF4444';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Visão geral em tempo real</p>
        </div>
        <button onClick={load} className="btn-secondary">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={Ticket}       label="Tickets Abertos"     value={summary?.open}           gradient="stat-indigo" />
        <StatCard icon={Clock}        label="Aguardando Cliente"  value={summary?.waitingClient}   gradient="stat-orange" />
        <StatCard icon={CheckCircle}  label="Resolvidos Hoje"     value={summary?.resolvedToday}   gradient="stat-green" />
        <StatCard icon={Monitor}      label="PDVs Offline"        value={summary?.offlineDevices}  gradient="stat-red"   sub={`${summary?.onlineDevices ?? 0} online`} />
        <StatCard icon={AlertTriangle} label="Alertas de SLA"     value={(sla?.breached?.length ?? 0) + (sla?.atRisk?.length ?? 0)}
                  gradient="stat-orange"
                  sub={`${sla?.breached?.length ?? 0} violados · ${sla?.atRisk?.length ?? 0} em risco`} />
      </div>

      {/* SLA Bar */}
      {summary && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background:'#F0FDF4' }}>
                <TrendingUp className="w-5 h-5" style={{ color:'#10B981' }} />
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color:'#0F172A' }}>Conformidade SLA</p>
                <p className="text-xs" style={{ color:'#94A3B8' }}>Últimos 30 dias</p>
              </div>
            </div>
            <span className="text-3xl font-extrabold" style={{ color: slaColor }}>{summary.slaCompliance}%</span>
          </div>
          <div className="h-3 rounded-full" style={{ background:'#F1F5F9' }}>
            <div className="h-3 rounded-full transition-all duration-700" style={{ width:`${summary.slaCompliance}%`, background: slaColor, boxShadow:`0 0 10px ${slaColor}60` }} />
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background:'#EEF2FF' }}>
              <Activity className="w-4 h-4" style={{ color:'#6366F1' }} />
            </div>
            <h3 className="font-bold text-sm" style={{ color:'#0F172A' }}>Tickets por Dia (7 dias)</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366F1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="date" tick={{ fontSize:11, fill:'#94A3B8' }} tickFormatter={v => v.slice(5)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:11, fill:'#94A3B8' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius:12, border:'1px solid #E2E8F0', boxShadow:'0 4px 20px rgba(0,0,0,0.08)' }} />
              <Area type="monotone" dataKey="count" stroke="#6366F1" fill="url(#grad)" strokeWidth={2.5} name="Tickets" dot={{ fill:'#6366F1', r:3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background:'#FFF7ED' }}>
              <AlertTriangle className="w-4 h-4" style={{ color:'#F59E0B' }} />
            </div>
            <h3 className="font-bold text-sm" style={{ color:'#0F172A' }}>Por Prioridade</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byPriority} dataKey="count" nameKey="priority" cx="50%" cy="50%" outerRadius={72} innerRadius={36}>
                {byPriority.map((e:any,i:number) => <Cell key={i} fill={PRIORITY_COLORS[e.priority] || '#94A3B8'} />)}
              </Pie>
              <Tooltip formatter={(v:any,n:any) => [v, PRIORITY_LABELS[n] || n]} contentStyle={{ borderRadius:12, border:'1px solid #E2E8F0' }} />
              <Legend formatter={(v:any) => PRIORITY_LABELS[v] || v} iconType="circle" iconSize={8} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SLA Alerts */}
      {sla && (sla.breached?.length > 0 || sla.atRisk?.length > 0) && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background:'#FEF2F2' }}>
              <AlertTriangle className="w-4 h-4" style={{ color:'#EF4444' }} />
            </div>
            <h3 className="font-bold text-sm" style={{ color:'#0F172A' }}>Alertas de SLA</h3>
          </div>
          <div className="space-y-2">
            {sla.breached?.map((t:any) => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background:'#FEF2F2', border:'1px solid #FECACA' }}>
                <div><span className="font-bold text-sm" style={{ color:'#DC2626' }}>{t.ticketNumber}</span><span className="text-sm ml-2" style={{ color:'#EF4444' }}>{t.subject}</span></div>
                <span className="badge badge-critical">SLA VIOLADO</span>
              </div>
            ))}
            {sla.atRisk?.map((t:any) => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background:'#FFFBEB', border:'1px solid #FDE68A' }}>
                <div><span className="font-bold text-sm" style={{ color:'#D97706' }}>{t.ticketNumber}</span><span className="text-sm ml-2" style={{ color:'#F59E0B' }}>{t.subject}</span></div>
                <span className="badge badge-high">EM RISCO</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
