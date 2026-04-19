'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ListChecks, Plus, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 12px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

const STATUS_LABELS: Record<string,string> = { pending:'Pendente', in_progress:'Em andamento', completed:'Concluída', cancelled:'Cancelada' };
const STATUS_STYLE: Record<string,{bg:string;color:string;dot:string}> = {
  pending:     { bg:'#FFF7ED', color:'#9A3412', dot:'#F97316' },
  in_progress: { bg:'#EEF2FF', color:'#3730A3', dot:'#4F46E5' },
  completed:   { bg:'#F0FDF4', color:'#166534', dot:'#16A34A' },
  cancelled:   { bg:'#F9FAFB', color:'#374151', dot:'#94A3B8' },
};
const PRIORITY_LABELS: Record<string,string> = { low:'Baixa', medium:'Média', high:'Alta', critical:'Crítica' };
const PRIORITY_STYLE: Record<string,{bg:string;color:string}> = {
  low:      { bg:'#F0FDF4', color:'#166534' },
  medium:   { bg:'#FFF7ED', color:'#9A3412' },
  high:     { bg:'#FEF2F2', color:'#991B1B' },
  critical: { bg:'#581C87', color:'#fff' },
};

export default function TarefasPage() {
  const { user } = useAuthStore();
  const router = useRouter();

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [focusField, setFocusField] = useState('');

  const load = async (pg: number, sf: string, pf: string) => {
    setLoading(true);
    try {
      const raw: any = await api.getTasks({ page: pg, perPage: 20, status: sf || undefined, priority: pf || undefined });
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
    setPriorityFilter('');
  }, [user?.id]);

  // Load on page/filter change
  useEffect(() => {
    load(page, statusFilter, priorityFilter);
  }, [page, statusFilter, priorityFilter]);

  // Debounced search (client-side filter)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  if (!hasPermission(user, 'tasks.view')) {
    return (
      <div className="space-y-6">
        <div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>
          Acesso negado. Você não tem permissão para visualizar as Tarefas.
        </div>
      </div>
    );
  }

  const filteredItems = debouncedSearch
    ? items.filter(t => t.title?.toLowerCase().includes(debouncedSearch.toLowerCase()))
    : items;

  const now = new Date();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#059669,#10B981)', boxShadow:'0 4px 14px rgba(16,185,129,0.3)' }}>
            <ListChecks className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="page-title">Tarefas</h1>
            <p className="page-subtitle">{total} tarefa{total !== 1 ? 's' : ''}</p>
          </div>
        </div>
        {hasPermission(user, 'tasks.create') && (
          <Link href="/dashboard/tarefas/novo" className="btn-primary" style={{ display:'inline-flex', alignItems:'center', gap:6, textDecoration:'none' }}>
            <Plus style={{ width:15, height:15 }} /> Nova Tarefa
          </Link>
        )}
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
              <option value="pending">Pendente</option>
              <option value="in_progress">Em andamento</option>
              <option value="completed">Concluída</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Prioridade</label>
            <select style={inp()} value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1); }}>
              <option value="">Todas</option>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
              <option value="critical">Crítica</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', gap:10, background:'#FAFBFC' }}>
          <div style={{ width:30, height:30, borderRadius:8, background:'#ECFDF5', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <ListChecks style={{ width:15, height:15, color:'#10B981' }} />
          </div>
          <h3 style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Tarefas</h3>
          <span style={{ background:'#ECFDF5', color:'#059669', padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>{total}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom:'1px solid #F1F5F9', background:'#FAFBFC' }}>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Título</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Prioridade</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Status</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Vencimento</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Atribuído</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding:24, textAlign:'center', color:'#94A3B8' }}>Carregando...</td></tr>}
            {!loading && filteredItems.length === 0 && (
              <tr><td colSpan={6} style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>Nenhuma tarefa encontrada</td></tr>
            )}
            {!loading && filteredItems.map((task: any) => {
              const st = STATUS_STYLE[task.status] || { bg:'#F1F5F9', color:'#64748B', dot:'#94A3B8' };
              const pr = PRIORITY_STYLE[task.priority] || { bg:'#F1F5F9', color:'#64748B' };
              const isOverdue = task.dueAt && !['completed','cancelled'].includes(task.status) && new Date(task.dueAt) < now;
              return (
                <tr key={task.id} className="table-row" style={{ cursor:'pointer' }} onClick={() => router.push(`/dashboard/tarefas/${task.id}`)}>
                  <td style={{ padding:'12px 16px', color:'#0F172A', fontWeight:600 }}>{task.title}</td>
                  <td style={{ padding:'12px 16px' }}>
                    <span style={{ background:pr.bg, color:pr.color, padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>
                      {PRIORITY_LABELS[task.priority] || task.priority}
                    </span>
                  </td>
                  <td style={{ padding:'12px 16px' }}>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:5, background:st.bg, color:st.color, padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>
                      <span style={{ width:6, height:6, borderRadius:'50%', background:st.dot }} />
                      {STATUS_LABELS[task.status] || task.status}
                    </span>
                  </td>
                  <td style={{ padding:'12px 16px', fontSize:13, color: isOverdue ? '#EF4444' : '#64748B', fontWeight: isOverdue ? 600 : 400 }}>
                    {task.dueAt ? format(new Date(task.dueAt), 'dd/MM/yy HH:mm', { locale: ptBR }) : '—'}
                    {isOverdue && <span style={{ marginLeft:4, fontSize:10 }}>VENCIDA</span>}
                  </td>
                  <td style={{ padding:'12px 16px', color:'#64748B', fontSize:13 }}>{task.assignedUser?.name || '—'}</td>
                  <td style={{ padding:'12px 16px' }}>
                    <button
                      className="btn-secondary"
                      style={{ padding:'5px 12px', fontSize:12 }}
                      onClick={e => { e.stopPropagation(); router.push(`/dashboard/tarefas/${task.id}`); }}
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
