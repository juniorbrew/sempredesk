'use client';
import { useEffect, useState, memo } from 'react';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import { usePresenceStore, useAgentStatus } from '@/store/presence.store';
import { STATUS_STYLE } from '@/lib/presence';
import { Users2, Plus, Edit2, Trash2, Mail, Phone, Eye, EyeOff } from 'lucide-react';

const ROLE_LABELS: Record<string,string> = { super_admin:'Super Admin', admin:'Administrador', manager:'Supervisor', technician:'Técnico', viewer:'Visualizador', client_contact:'Contato Cliente' };
const ROLE_COLORS: Record<string,{ bg:string; color:string }> = { super_admin:{ bg:'#FEE2E2', color:'#991B1B' }, admin:{ bg:'#FEE2E2', color:'#DC2626' }, manager:{ bg:'#DBEAFE', color:'#1D4ED8' }, technician:{ bg:'#DCFCE7', color:'#15803D' }, viewer:{ bg:'#F1F5F9', color:'#475569' }, client_contact:{ bg:'#FEF9C3', color:'#854D0E' } };
const EMPTY = { name:'', email:'', password:'', role:'technician', phone:'', status:'active' };
const SYSTEM_ROLES = ['super_admin', 'admin', 'manager', 'technician', 'viewer'];

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 12px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

const AgentCard = memo(function AgentCard({ m, canEdit, canDelete, onEdit, onRemove }: { m: any; canEdit: boolean; canDelete: boolean; onEdit: (m: any) => void; onRemove: (m: any) => void }) {
  const status = useAgentStatus(m.id);
  const style = STATUS_STYLE[status] || STATUS_STYLE.offline;
  const roleStyle = ROLE_COLORS[m.role] || { bg:'#F1F5F9', color:'#475569' };
  return (
    <div className="card p-5" style={{ opacity:m.status==='inactive'?0.7:1 }}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-base text-white shrink-0"
            style={{ background:'linear-gradient(135deg,#8B5CF6,#7C3AED)', boxShadow:'0 2px 8px rgba(139,92,246,0.3)' }}>
            {m.name?.[0]?.toUpperCase()||'?'}
          </div>
          <div>
            <p className="font-bold text-sm" style={{ color:'#0F172A' }}>{m.name}</p>
            <span style={{ background:roleStyle.bg, color:roleStyle.color, padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:700 }}>
              {ROLE_LABELS[m.role]||m.role}
            </span>
          </div>
        </div>
        <span style={{ background: style.bg, color: style.color, padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
          {style.label}
        </span>
      </div>
      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 text-xs" style={{ color:'#64748B' }}>
          <Mail className="w-3.5 h-3.5 shrink-0" style={{ color:'#94A3B8' }} />{m.email}
        </div>
        {m.phone && (
          <div className="flex items-center gap-2 text-xs" style={{ color:'#64748B' }}>
            <Phone className="w-3.5 h-3.5 shrink-0" style={{ color:'#94A3B8' }} />{m.phone}
          </div>
        )}
      </div>
      {(canEdit || canDelete) && (
        <div className="flex gap-2 pt-3" style={{ borderTop:'1px solid #F1F5F9' }}>
          {canEdit && (
            <button onClick={() => onEdit(m)} className="btn-secondary" style={{ flex:1, justifyContent:'center', fontSize:12, padding:'7px 0' }}>
              <Edit2 className="w-3.5 h-3.5" /> Editar
            </button>
          )}
          {canDelete && m.status==='active' && (
            <button onClick={() => onRemove(m)} className="btn-danger" style={{ padding:'7px 10px' }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default function TeamPage() {
  const { user } = useAuthStore();
  const onlineIds = usePresenceStore((s) => s.onlineIds);
  const canCreate = hasPermission(user, 'agent.create');
  const canEdit = hasPermission(user, 'agent.edit');
  const canDelete = hasPermission(user, 'agent.delete');
  const [team, setTeam] = useState<any[]>([]);
  const [roles, setRoles] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [allDepts, setAllDepts] = useState<string[]>([]);
  const [agentDepts, setAgentDepts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [focusField, setFocusField] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [filter, setFilter] = useState('all');

  const canViewAgents = hasPermission(user, 'agent.view');

  const load = async () => {
    // Sem permissão agent.view não há nada para carregar — evita 403 no console
    if (!canViewAgents) { setLoading(false); return; }
    setLoading(true);
    try {
      const [teamRes, rolesRes, deptsRes] = await Promise.all([
        api.getTeam() as Promise<any[]>,
        (api.getRoles() as Promise<any[]>).catch(() => []),
        (api.getTicketSettings({ type: 'department', perPage: 200 }) as Promise<any>).catch(() => null),
      ]);
      setTeam((teamRes as any[]) || []);
      setRoles((rolesRes || []).filter((r: any) => r.slug !== 'client_contact'));
      const deptList = Array.isArray(deptsRes) ? deptsRes : Array.isArray((deptsRes as any)?.data) ? (deptsRes as any).data : [];
      setAllDepts(deptList.map((d: any) => d.name).filter(Boolean).sort());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [canViewAgents]);

  const openModal = async (m?:any) => {
    setEditing(m||null); setError(''); setAgentDepts([]);
    setForm(m ? { name:m.name, email:m.email, password:'', role:m.role, phone:m.phone||'', status:m.status } : { ...EMPTY });
    if (m?.id) {
      try {
        const depts = await (api as any).getAgentDepartments(m.id) as any[];
        setAgentDepts((depts || []).map((d: any) => d.departmentName));
      } catch {}
    }
    setShowModal(true);
  };

  const toggleDept = (name: string) =>
    setAgentDepts(prev => prev.includes(name) ? prev.filter(d => d !== name) : [...prev, name]);

  const handleSave = async () => {
    if (!form.name.trim()||!form.email.trim()) { setError('Nome e e-mail são obrigatórios'); return; }
    if (!editing && !form.password.trim()) { setError('Senha é obrigatória para novo membro'); return; }
    setSaving(true); setError('');
    try {
      const data = { ...form };
      if (!data.password) delete data.password;
      let savedId = editing?.id;
      if (editing) {
        const updated = (await api.updateTeamMember(editing.id, data)) as Record<string, unknown>;
        setTeam((prev) => prev.map((t) => (t.id === editing.id ? { ...t, ...updated } : t)));
      } else {
        const created = (await api.createTeamMember(data)) as { id?: string };
        savedId = created.id;
        setTeam((prev) => [...prev, created as any].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      }
      // Salva departamentos do agente
      if (savedId) {
        await (api as any).setAgentDepartments(savedId, agentDepts).catch(() => {});
      }
      setShowModal(false);
    } catch(e:any) { setError(e?.response?.data?.message||'Erro ao salvar'); }
    setSaving(false);
  };

  const handleRemove = async (m:any) => {
    if (!confirm(`Inativar "${m.name}"?`)) return;
    try {
      await api.removeTeamMember(m.id);
      setTeam((prev) => prev.map((t) => (t.id === m.id ? { ...t, status: 'inactive' } : t)));
    } catch {}
  };

  const f = (k:string) => (e:any) => setForm((p:any)=>({...p,[k]:e.target.value}));
  const filtered = team.filter(m => filter==='all' || m.status===filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#8B5CF6,#7C3AED)', boxShadow:'0 4px 14px rgba(139,92,246,0.35)' }}>
            <Users2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="page-title">Equipe e Usuários</h1>
            <p className="page-subtitle">{filtered.length} membro{filtered.length!==1?'s':''} • {onlineIds.size} online</p>
          </div>
        </div>
        {canCreate && (
          <button onClick={() => openModal()} className="btn-primary">
            <Plus className="w-4 h-4" /> Novo Membro
          </button>
        )}
      </div>

      {/* Filtro */}
      <div className="card p-4 flex gap-3">
        {[['all','Todos'],['active','Ativos'],['inactive','Inativos']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ padding:'7px 16px', borderRadius:10, border:`1.5px solid ${filter===v?'#6366F1':'#E2E8F0'}`, background:filter===v?'#EEF2FF':'transparent', color:filter===v?'#4F46E5':'#64748B', fontSize:13, cursor:'pointer', fontWeight:filter===v?700:400, transition:'all 0.15s' }}>{l}</button>
        ))}
        <span className="ml-auto text-sm" style={{ color:'#94A3B8', alignSelf:'center' }}>{filtered.length} resultado{filtered.length!==1?'s':''}</span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-16" style={{ color:'#94A3B8' }}>
          <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Carregando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-16 text-center">
          <Users2 className="w-12 h-12 mx-auto mb-3" style={{ color:'#E2E8F0' }} />
          <p className="font-medium mb-1" style={{ color:'#475569' }}>Nenhum membro encontrado</p>
          {canCreate && (
            <button onClick={() => openModal()} className="btn-primary mt-4">
              <Plus className="w-4 h-4" /> Adicionar Membro
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((m:any) => (
            <AgentCard key={m.id} m={m} canEdit={canEdit} canDelete={canDelete} onEdit={openModal} onRemove={handleRemove} />
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(15,23,42,0.55)', backdropFilter:'blur(4px)' }}>
          <div className="bg-white rounded-2xl w-full max-w-md animate-fade-up" style={{ boxShadow:'0 20px 60px rgba(0,0,0,0.15)' }}>
            <div className="flex items-center justify-between p-5" style={{ borderBottom:'1px solid #F1F5F9' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#8B5CF6,#7C3AED)' }}>
                  <Users2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold" style={{ color:'#0F172A', fontSize:15 }}>{editing?'Editar Membro':'Novo Membro'}</h2>
                  <p className="text-xs" style={{ color:'#94A3B8' }}>{editing?'Atualize os dados':'Adicione um novo membro à equipe'}</p>
                </div>
              </div>
              <button onClick={() => setShowModal(false)} style={{ background:'#F1F5F9', border:'none', borderRadius:8, width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#64748B', fontSize:18 }}>×</button>
            </div>
            {error && <div style={{ margin:'12px 20px 0', background:'#FEF2F2', color:'#DC2626', padding:'8px 12px', borderRadius:8, fontSize:13 }}>{error}</div>}
            <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={lbl}>Nome completo <span style={{ color:'#6366F1' }}>*</span></label>
                <input value={form.name} onChange={f('name')} onFocus={()=>setFocusField('name')} onBlur={()=>setFocusField('')} style={inp(focusField==='name')} placeholder="Nome do membro" />
              </div>
              <div>
                <label style={lbl}>E-mail <span style={{ color:'#6366F1' }}>*</span></label>
                <input type="email" value={form.email} onChange={f('email')} onFocus={()=>setFocusField('email')} onBlur={()=>setFocusField('')} style={inp(focusField==='email')} placeholder="email@exemplo.com" />
              </div>
              <div>
                <label style={lbl}>{editing?'Nova senha (deixe em branco para manter)':'Senha'} {!editing&&<span style={{ color:'#6366F1' }}>*</span>}</label>
                <div style={{ position:'relative' }}>
                  <input type={showPass?'text':'password'} value={form.password} onChange={f('password')} onFocus={()=>setFocusField('pass')} onBlur={()=>setFocusField('')} style={{ ...inp(focusField==='pass'), paddingRight:40 }} placeholder={editing?'••••••••':'Mínimo 8 caracteres'} />
                  <button type="button" onClick={()=>setShowPass(p=>!p)} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94A3B8', display:'flex' }}>
                    {showPass?<EyeOff style={{width:16,height:16}}/>:<Eye style={{width:16,height:16}}/>}
                  </button>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={lbl}>Função</label>
                  <select value={form.role} onChange={f('role')} onFocus={()=>setFocusField('role')} onBlur={()=>setFocusField('')} style={{ ...inp(focusField==='role'), appearance:'none' as const }}>
                    {(roles.length > 0
                      ? roles
                      : Object.entries(ROLE_LABELS).filter(([v])=>v!=='client_contact').map(([v,l])=>({ slug:v, name:l }))
                    ).map((r: any)=><option key={r.slug} value={r.slug}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Status</label>
                  <select value={form.status} onChange={f('status')} onFocus={()=>setFocusField('status')} onBlur={()=>setFocusField('')} style={{ ...inp(focusField==='status'), appearance:'none' as const }}>
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl}>Telefone</label>
                <input value={form.phone} onChange={f('phone')} onFocus={()=>setFocusField('phone')} onBlur={()=>setFocusField('')} style={inp(focusField==='phone')} placeholder="(00) 00000-0000" />
              </div>
            </div>

            {/* Departamentos para distribuição automática */}
            {allDepts.length > 0 && (
              <div style={{ padding:'0 20px 16px' }}>
                <label style={{ ...lbl, marginBottom:10 }}>
                  Departamentos (distribuição automática de chamados)
                </label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {allDepts.map(dept => {
                    const selected = agentDepts.includes(dept);
                    return (
                      <button key={dept} type="button" onClick={() => toggleDept(dept)}
                        style={{ padding:'5px 12px', borderRadius:20, fontSize:12, fontWeight:600, border:`1.5px solid ${selected ? '#4F46E5' : '#E2E8F0'}`, background: selected ? '#EEF2FF' : '#fff', color: selected ? '#4F46E5' : '#64748B', cursor:'pointer', transition:'all .15s' }}>
                        {selected ? '✓ ' : ''}{dept}
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize:11, color:'#94A3B8', marginTop:6 }}>
                  Tickets do departamento selecionado serão distribuídos automaticamente para este agente quando ele estiver online.
                </p>
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, padding:'14px 20px', borderTop:'1px solid #F1F5F9' }}>
              <button onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ minWidth:120, justifyContent:'center' }}>
                {saving?'Salvando...':'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
