'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Plus, Search, Edit2, Trash2, Eye, Network, RefreshCw } from 'lucide-react';

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:6, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 14px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, transition:'all 0.15s', boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none' });

export default function NetworksPage() {
  const router = useRouter();
  const [networks, setNetworks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name:'', responsible:'', phone:'', email:'', notes:'', status:'active' });
  const [saving, setSaving] = useState(false);
  const [clientCounts, setClientCounts] = useState<Record<string,number>>({});
  const [focusField, setFocusField] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getNetworks(search || undefined);
      const list = Array.isArray(res) ? res : Array.isArray((res as any)?.data) ? (res as any).data : [];
      setNetworks(list);
      const counts:Record<string,number> = {};
      await Promise.all(list.map(async (n:any) => {
        try {
          const r = await api.getCustomers({ networkId:n.id, limit:1 });
          counts[n.id] = (r as any)?.total || 0;
        } catch { counts[n.id] = 0; }
      }));
      setClientCounts(counts);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(load, 400); return () => clearTimeout(t); }, [search]);

  const filtered = networks.filter(n => filter === 'all' || n.status === filter);

  const openModal = (n?:any) => {
    setEditing(n || null);
    setForm(n ? { name:n.name, responsible:n.responsible||'', phone:n.phone||'', email:n.email||'', notes:n.notes||'', status:n.status } : { name:'', responsible:'', phone:'', email:'', notes:'', status:'active' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        const updated = (await api.updateNetwork(editing.id, form)) as Record<string, unknown>;
        setNetworks((prev) => prev.map((n) => (n.id === editing.id ? { ...n, ...updated } : n)));
      } else {
        const created = await api.createNetwork(form);
        const full = Array.isArray(created) ? created[0] : (created as { id?: string } | null);
        if (full?.id) setNetworks((prev) => [...prev, full].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      }
      setShowModal(false);
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id:string) => {
    if (!confirm('Desativar esta rede?')) return;
    try {
      await api.deleteNetwork(id);
      setNetworks((prev) => prev.map((n) => (n.id === id ? { ...n, status: 'inactive' } : n)));
    } catch {}
  };

  const f = (k:string) => (e:any) => setForm((p:any) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366F1,#4F46E5)', boxShadow:'0 4px 14px rgba(99,102,241,0.35)' }}>
            <Network className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="page-title">Redes de Postos</h1>
            <p className="page-subtitle">{filtered.length} rede{filtered.length !== 1 ? 's' : ''} cadastrada{filtered.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <button onClick={() => openModal()} className="btn-primary">
          <Plus className="w-4 h-4" /> Nova Rede
        </button>
      </div>

      {/* Filtros */}
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color:'#CBD5E1' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar rede..."
            className="input" style={{ paddingLeft:38 }} />
        </div>
        <div className="flex gap-2">
          {[['all','Todas'],['active','Ativas'],['inactive','Inativas']].map(([v,l]) => (
            <button key={v} onClick={() => setFilter(v)}
              style={{ padding:'8px 16px', borderRadius:10, border:`1.5px solid ${filter===v?'#6366F1':'#E2E8F0'}`, background:filter===v?'#EEF2FF':'transparent', color:filter===v?'#4F46E5':'#64748B', fontSize:13, cursor:'pointer', fontWeight:filter===v?700:400, transition:'all 0.15s' }}>{l}</button>
          ))}
        </div>
        <button onClick={load} className="btn-secondary" style={{ padding:'8px 10px' }}>
          <RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} />
        </button>
        <span className="ml-auto text-sm" style={{ color:'#94A3B8' }}>{filtered.length} rede{filtered.length!==1?'s':''}</span>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom:'2px solid #F1F5F9', background:'#FAFBFC' }}>
              {['Código','Nome da Rede','Postos','Responsável','Contato','Status','Ações'].map(h => (
                <th key={h} className="table-header" style={{ padding:'13px 16px', textAlign:'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-16" style={{ color:'#94A3B8' }}>
                <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                Carregando...
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-16" style={{ color:'#94A3B8' }}>
                <Network className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="font-medium">Nenhuma rede encontrada</p>
              </td></tr>
            ) : filtered.map((n:any) => (
              <tr key={n.id} className="table-row"
                onMouseEnter={e => e.currentTarget.style.background='#FAFBFC'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <td className="table-cell">
                  <span style={{ background:'#EEF2FF', color:'#4F46E5', padding:'3px 9px', borderRadius:6, fontSize:11, fontFamily:'monospace', fontWeight:700 }}>#{n.code}</span>
                </td>
                <td className="table-cell">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold text-xs text-white"
                      style={{ background:'linear-gradient(135deg,#6366F1,#4F46E5)' }}>
                      {n.name.slice(0,2).toUpperCase()}
                    </div>
                    <span className="font-semibold" style={{ color:'#0F172A' }}>{n.name}</span>
                  </div>
                </td>
                <td className="table-cell">
                  <span style={{ background:'#EFF6FF', color:'#2563EB', padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:700, border:'1px solid #BFDBFE' }}>
                    {clientCounts[n.id] ?? 0} posto{(clientCounts[n.id] ?? 0) !== 1 ? 's' : ''}
                  </span>
                </td>
                <td className="table-cell" style={{ color:'#475569' }}>{n.responsible || '—'}</td>
                <td className="table-cell" style={{ color:'#64748B', fontSize:12 }}>
                  {n.email && <div>{n.email}</div>}
                  {n.phone && <div>{n.phone}</div>}
                  {!n.email && !n.phone && '—'}
                </td>
                <td className="table-cell">
                  <span className={`badge ${n.status === 'active' ? 'badge-active' : 'badge-inactive'}`}>
                    {n.status === 'active' ? 'Ativa' : 'Inativa'}
                  </span>
                </td>
                <td className="table-cell">
                  <div className="flex gap-2">
                    <button onClick={() => router.push(`/dashboard/networks/${n.id}`)} title="Ver Postos" className="btn-secondary" style={{ padding:'6px 8px' }}>
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => openModal(n)} title="Editar" className="btn-secondary" style={{ padding:'6px 8px' }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(n.id)} title="Desativar" className="btn-danger" style={{ padding:'6px 8px' }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(15,23,42,0.55)', backdropFilter:'blur(4px)' }}>
          <div className="bg-white rounded-2xl w-full max-w-lg animate-fade-up" style={{ boxShadow:'0 20px 60px rgba(0,0,0,0.15)' }}>
            <div className="flex items-center justify-between p-6" style={{ borderBottom:'1px solid #F1F5F9' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366F1,#4F46E5)' }}>
                  <Network className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-base" style={{ color:'#0F172A' }}>{editing ? 'Editar Rede' : 'Nova Rede'}</h2>
                  <p className="text-xs" style={{ color:'#94A3B8' }}>Preencha os dados da rede</p>
                </div>
              </div>
              <button onClick={() => setShowModal(false)}
                style={{ background:'#F1F5F9', border:'none', borderRadius:10, width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#64748B', fontSize:18 }}>×</button>
            </div>
            <div style={{ padding:24, display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              {[
                { k:'name', l:'Nome da Rede', req:true, col:2 },
                { k:'responsible', l:'Responsável', col:2 },
                { k:'email', l:'E-mail', col:1 },
                { k:'phone', l:'Telefone', col:1 },
                { k:'notes', l:'Observações', col:2 },
              ].map(({ k, l, req, col }) => (
                <div key={k} style={{ gridColumn:`1 / span ${col}` }}>
                  <label style={lbl}>{l} {req && <span style={{ color:'#6366F1' }}>*</span>}</label>
                  {k === 'notes' ? (
                    <textarea value={(form as any)[k]} onChange={f(k)} rows={3} onFocus={() => setFocusField(k)} onBlur={() => setFocusField('')}
                      style={{ ...inp(focusField===k), resize:'vertical' as const }} />
                  ) : (
                    <input value={(form as any)[k]} onChange={f(k)} onFocus={() => setFocusField(k)} onBlur={() => setFocusField('')}
                      style={inp(focusField===k)} />
                  )}
                </div>
              ))}
              <div>
                <label style={lbl}>Status</label>
                <div style={{ display:'flex', gap:8 }}>
                  {[['active','Ativa'],['inactive','Inativa']].map(([v,l]) => (
                    <button key={v} onClick={() => setForm(p => ({ ...p, status:v }))}
                      style={{ flex:1, padding:'9px 0', borderRadius:10, border:`1.5px solid ${form.status===v?(v==='active'?'#10B981':'#EF4444'):'#E2E8F0'}`, background:form.status===v?(v==='active'?'#F0FDF4':'#FEF2F2'):'transparent', color:form.status===v?(v==='active'?'#16A34A':'#DC2626'):'#94A3B8', fontSize:13, cursor:'pointer', fontWeight:form.status===v?700:400, transition:'all 0.15s' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, padding:'16px 24px', borderTop:'1px solid #F1F5F9' }}>
              <button onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()} className="btn-primary" style={{ opacity:!form.name.trim()?0.5:1 }}>
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
