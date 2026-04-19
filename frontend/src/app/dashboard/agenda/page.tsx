'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Plus, Search, Link2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 12px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

const STATUS_LABELS: Record<string,string> = { scheduled:'Agendado', confirmed:'Confirmado', cancelled:'Cancelado', completed:'Concluído', rescheduled:'Reagendado' };
const STATUS_STYLE: Record<string,{bg:string;color:string;dot:string}> = {
  scheduled:   { bg:'#EEF2FF', color:'#3730A3', dot:'#4F46E5' },
  confirmed:   { bg:'#F0FDF4', color:'#166534', dot:'#16A34A' },
  cancelled:   { bg:'#FEF2F2', color:'#991B1B', dot:'#EF4444' },
  completed:   { bg:'#F0F9FF', color:'#0369A1', dot:'#0284C7' },
  rescheduled: { bg:'#FFF7ED', color:'#9A3412', dot:'#F97316' },
};
const EVENT_TYPE_LABELS: Record<string,string> = { internal:'Interno', client_return:'Retorno', sla_reminder:'Lembrete SLA', meeting:'Reunião', sync_google:'Google', sync_outlook:'Outlook' };

export default function AgendaPage() {
  const { user } = useAuthStore();
  const router = useRouter();

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [focusField, setFocusField] = useState('');

  const todayStr = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });

  const load = async (pg: number, sf: string, tf: string) => {
    setLoading(true);
    try {
      const raw: any = await api.getCalendarEvents({ page: pg, perPage: 20, status: sf || undefined, eventType: tf || undefined });
      const list = raw?.data || raw?.items || (Array.isArray(raw) ? raw : []);
      setItems(list);
      setTotal(raw?.total ?? list.length);
      setTotalPages(raw?.totalPages ?? raw?.lastPage ?? 1);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // Reset on auth change
  useEffect(() => {
    setPage(1);
    setSearch('');
    setStatusFilter('');
    setTypeFilter('');
  }, [user?.id]);

  // Load on page/filter change
  useEffect(() => {
    load(page, statusFilter, typeFilter);
  }, [page, statusFilter, typeFilter]);

  // Debounced search (search by title not directly supported in API, apply client-side)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  if (!hasPermission(user, 'agenda.view')) {
    return (
      <div className="space-y-6">
        <div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>
          Acesso negado. Você não tem permissão para visualizar a Agenda.
        </div>
      </div>
    );
  }

  const filteredItems = debouncedSearch
    ? items.filter(ev => ev.title?.toLowerCase().includes(debouncedSearch.toLowerCase()))
    : items;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#1D4ED8,#3B82F6)', boxShadow:'0 4px 14px rgba(59,130,246,0.3)' }}>
            <CalendarDays className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="page-title">Agenda</h1>
            <p className="page-subtitle">{todayStr} · {total} evento{total !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Link
            href="/dashboard/agenda/integracoes"
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:10, border:'1.5px solid #E2E8F0', background:'#fff', color:'#64748B', fontSize:13, fontWeight:500, textDecoration:'none' }}
          >
            <Link2 style={{ width:14, height:14 }} /> Integrações
          </Link>
          {hasPermission(user, 'agenda.create') && (
            <Link href="/dashboard/agenda/novo" className="btn-primary" style={{ display:'inline-flex', alignItems:'center', gap:6, textDecoration:'none' }}>
              <Plus style={{ width:15, height:15 }} /> Novo Evento
            </Link>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="card p-4">
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 180px 200px', gap:12, alignItems:'flex-end' }}>
          <div>
            <label style={lbl}>Buscar</label>
            <div style={{ position:'relative' }}>
              <Search style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', width:14, height:14, color:'#94A3B8' }} />
              <input
                style={{ ...inp(focusField==='search'), paddingLeft:32 }}
                placeholder="Buscar por título..."
                value={search}
                onFocus={() => setFocusField('search')}
                onBlur={() => setFocusField('')}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label style={lbl}>Status</label>
            <select style={inp()} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="">Todos</option>
              <option value="scheduled">Agendado</option>
              <option value="confirmed">Confirmado</option>
              <option value="cancelled">Cancelado</option>
              <option value="completed">Concluído</option>
              <option value="rescheduled">Reagendado</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Tipo</label>
            <select style={inp()} value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
              <option value="">Todos</option>
              <option value="internal">Interno</option>
              <option value="client_return">Retorno</option>
              <option value="meeting">Reunião</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', gap:10, background:'#FAFBFC' }}>
          <div style={{ width:30, height:30, borderRadius:8, background:'#EFF6FF', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <CalendarDays style={{ width:15, height:15, color:'#3B82F6' }} />
          </div>
          <h3 style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Eventos</h3>
          <span style={{ background:'#EFF6FF', color:'#1D4ED8', padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>{total}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom:'1px solid #F1F5F9', background:'#FAFBFC' }}>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Título</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Tipo</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Data/Hora</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Status</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Atribuído</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding:24, textAlign:'center', color:'#94A3B8' }}>Carregando...</td></tr>}
            {!loading && filteredItems.length === 0 && (
              <tr><td colSpan={6} style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>Nenhum evento encontrado</td></tr>
            )}
            {!loading && filteredItems.map((ev: any) => {
              const st = STATUS_STYLE[ev.status] || { bg:'#F1F5F9', color:'#64748B', dot:'#94A3B8' };
              return (
                <tr
                  key={ev.id}
                  className="table-row"
                  style={{ cursor:'pointer' }}
                  onClick={() => router.push(`/dashboard/agenda/${ev.id}`)}
                >
                  <td style={{ padding:'12px 16px', color:'#0F172A', fontWeight:600 }}>{ev.title}</td>
                  <td style={{ padding:'12px 16px', color:'#64748B', fontSize:13 }}>{EVENT_TYPE_LABELS[ev.eventType] || ev.eventType}</td>
                  <td style={{ padding:'12px 16px', color:'#64748B', fontSize:13 }}>
                    {ev.startsAt ? format(new Date(ev.startsAt), "dd/MM/yy 'às' HH:mm", { locale: ptBR }) : '—'}
                  </td>
                  <td style={{ padding:'12px 16px' }}>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:5, background:st.bg, color:st.color, padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>
                      <span style={{ width:6, height:6, borderRadius:'50%', background:st.dot }} />
                      {STATUS_LABELS[ev.status] || ev.status}
                    </span>
                  </td>
                  <td style={{ padding:'12px 16px', color:'#64748B', fontSize:13 }}>{ev.assignedUser?.name || '—'}</td>
                  <td style={{ padding:'12px 16px' }}>
                    <button
                      className="btn-secondary"
                      style={{ padding:'5px 12px', fontSize:12 }}
                      onClick={e => { e.stopPropagation(); router.push(`/dashboard/agenda/${ev.id}`); }}
                    >
                      Ver
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Paginação */}
        {totalPages > 1 && (
          <div style={{ padding:'14px 20px', borderTop:'1px solid #F1F5F9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:13, color:'#64748B' }}>Página {page} de {totalPages}</span>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding:'6px 14px', fontSize:13 }}>Anterior</button>
              <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ padding:'6px 14px', fontSize:13 }}>Próxima</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
