'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Plus, FolderTree, Tag, Layers, Edit2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

const TYPE_LABELS: Record<string,string> = { department:'Departamento', category:'Categoria', subcategory:'Subcategoria' };
const TYPE_COLORS: Record<string,{ bg:string; color:string; gradient:string }> = {
  department: { bg:'#EEF2FF', color:'#4F46E5', gradient:'linear-gradient(135deg,#6366F1,#4F46E5)' },
  category:   { bg:'#F0FDF4', color:'#16A34A', gradient:'linear-gradient(135deg,#10B981,#059669)' },
  subcategory:{ bg:'#FFF7ED', color:'#D97706', gradient:'linear-gradient(135deg,#F59E0B,#D97706)' },
};
const TYPE_ICONS: Record<string,any> = { department:FolderTree, category:Tag, subcategory:Layers };

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 12px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

export function SettingsContent({ defaultType = 'department' }: { defaultType?: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({ type:defaultType, name:'', parentId:'', sortOrder:0 });
  const [focusField, setFocusField] = useState('');

  const departments = useMemo(() => items.filter(i=>i.type==='department'&&i.active), [items]);
  const categories  = useMemo(() => items.filter(i=>i.type==='category'&&i.active), [items]);
  const availableParents = useMemo(() => {
    if (defaultType==='category') return departments;
    if (defaultType==='subcategory') return categories;
    return [];
  }, [defaultType, departments, categories]);

  const load = async () => {
    setLoading(true);
    try {
      const raw = await api.getTicketSettings();
      const list = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.data) ? (raw as any).data : [];
      setItems(list);
    } catch(e){ console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setForm({ type:defaultType, name:'', parentId:'', sortOrder:0 }); setEditingId(''); }, [defaultType]);

  const reset = () => { setEditingId(''); setForm({ type:defaultType, name:'', parentId:'', sortOrder:0 }); };

  const submit = async (e:FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const payload = { type:defaultType, name:form.name, parentId:defaultType==='department'?undefined:(form.parentId||undefined), sortOrder:Number(form.sortOrder||0), active:true };
      if (editingId) await api.updateTicketSetting(editingId, payload);
      else await api.createTicketSetting(payload);
      await load(); reset();
    } catch(e:any){ toast.error(e?.response?.data?.message||'Erro ao salvar'); }
    setSaving(false);
  };

  const editItem = (item:any) => { setEditingId(item.id); setForm({ type:item.type, name:item.name, parentId:item.parentId||'', sortOrder:item.sortOrder||0 }); };
  const removeItem = async (id:string) => {
    if (!window.confirm('Inativar este cadastro?')) return;
    try { await api.deleteTicketSetting(id); await load(); if (editingId===id) reset(); } catch(e:any){ toast.error(e?.response?.data?.message||'Erro'); }
  };
  const resolveParentName = (item:any) => items.find(i=>i.id===item.parentId)?.name||'—';

  const typeItems = items.filter(i=>i.type===defaultType);
  const cfg = TYPE_COLORS[defaultType]||TYPE_COLORS.department;
  const Icon = TYPE_ICONS[defaultType]||FolderTree;
  const typeLabel = TYPE_LABELS[defaultType]||defaultType;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background:cfg.gradient, boxShadow:'0 4px 14px rgba(99,102,241,0.3)' }}>
            <Icon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="page-title">{typeLabel}s</h1>
            <p className="page-subtitle">{typeItems.length} {typeLabel.toLowerCase()}{typeItems.length!==1?'s':''} cadastrado{typeItems.length!==1?'s':''}</p>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:cfg.bg }}>
            <Plus className="w-4 h-4" style={{ color:cfg.color }} />
          </div>
          <h2 className="table-header">{editingId?`Editar ${typeLabel}`:`Novo ${typeLabel}`}</h2>
        </div>
        <form onSubmit={submit}>
          <div style={{ display:'grid', gridTemplateColumns:`1fr ${defaultType!=='department'?'1fr ':''} 120px auto`, gap:14, marginBottom:16, alignItems:'flex-end' }}>
            <div>
              <label style={lbl}>Nome <span style={{ color:cfg.color }}>*</span></label>
              <input style={inp(focusField==='name')} value={form.name} required
                onFocus={()=>setFocusField('name')} onBlur={()=>setFocusField('')}
                onChange={e=>setForm({...form,name:e.target.value})} placeholder={`Nome do ${typeLabel.toLowerCase()}...`} />
            </div>
            {defaultType!=='department' && (
              <div>
                <label style={lbl}>{defaultType==='category'?'Departamento':'Categoria'}</label>
                <select style={{ ...inp(focusField==='parent'), appearance:'none' as const }} value={form.parentId}
                  onFocus={()=>setFocusField('parent')} onBlur={()=>setFocusField('')}
                  onChange={e=>setForm({...form,parentId:e.target.value})}>
                  <option value="">Selecione</option>
                  {availableParents.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={lbl}>Ordem</label>
              <input type="number" style={inp(focusField==='order')} value={form.sortOrder}
                onFocus={()=>setFocusField('order')} onBlur={()=>setFocusField('')}
                onChange={e=>setForm({...form,sortOrder:Number(e.target.value)})} />
            </div>
            <div style={{ display:'flex', gap:8 }}>
              {editingId && <button type="button" onClick={reset} className="btn-secondary" style={{ whiteSpace:'nowrap' }}>Cancelar</button>}
              <button type="submit" disabled={saving} className="btn-primary" style={{ whiteSpace:'nowrap' }}>
                {saving?'Salvando...':editingId?'Salvar':'Cadastrar'}
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className="card overflow-hidden">
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', gap:10, background:'#FAFBFC' }}>
          <div style={{ width:30, height:30, borderRadius:8, background:cfg.bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Icon style={{ width:15, height:15, color:cfg.color }} />
          </div>
          <h3 style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>{typeLabel}s cadastrado{typeItems.length!==1?'s':''}</h3>
          <span style={{ background:cfg.bg, color:cfg.color, padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>{typeItems.length}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom:'1px solid #F1F5F9', background:'#FAFBFC' }}>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Nome</th>
              {defaultType!=='department' && <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Pai</th>}
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Ordem</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Status</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding:24, textAlign:'center', color:'#94A3B8' }}>Carregando...</td></tr>
            ) : typeItems.length===0 ? (
              <tr><td colSpan={5} style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>
                <Icon style={{ width:32, height:32, margin:'0 auto 12px', opacity:0.2 }} />
                <p>Nenhum {typeLabel.toLowerCase()} cadastrado</p>
              </td></tr>
            ) : typeItems.map(item => (
              <tr key={item.id} className="table-row"
                onMouseEnter={e=>e.currentTarget.style.background='#FAFBFC'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{ padding:'12px 16px', fontWeight:600, color:'#0F172A' }}>{item.name}</td>
                {defaultType!=='department' && <td style={{ padding:'12px 16px', color:'#64748B', fontSize:12 }}>{resolveParentName(item)}</td>}
                <td style={{ padding:'12px 16px', color:'#94A3B8', fontSize:12 }}>{item.sortOrder||0}</td>
                <td style={{ padding:'12px 16px' }}>
                  <span style={{ background:item.active?'#DCFCE7':'#FEE2E2', color:item.active?'#15803D':'#DC2626', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>
                    {item.active?'Ativo':'Inativo'}
                  </span>
                </td>
                <td style={{ padding:'12px 16px' }}>
                  <div style={{ display:'flex', gap:6 }}>
                    <button onClick={()=>editItem(item)} className="btn-secondary" style={{ padding:'5px 7px' }}><Edit2 style={{width:13,height:13}} /></button>
                    {item.active && <button onClick={()=>removeItem(item.id)} className="btn-danger" style={{ padding:'5px 7px' }}><Trash2 style={{width:13,height:13}} /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
