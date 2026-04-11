'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Edit2, Plus, Tag, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 12px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

export default function TagsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [focusField, setFocusField] = useState('');
  const [form, setForm] = useState({ name:'', color:'#4F46E5', sortOrder:0 });

  const load = async () => {
    setLoading(true);
    try {
      const raw = await api.getTags();
      const list = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.data) ? (raw as any).data : [];
      setItems(list);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const reset = () => {
    setEditingId('');
    setForm({ name:'', color:'#4F46E5', sortOrder:0 });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name, color: form.color || undefined, sortOrder: Number(form.sortOrder || 0), active: true };
      if (editingId) await api.updateTag(editingId, payload);
      else await api.createTag(payload);
      await load();
      reset();
      toast.success(editingId ? 'Tag atualizada' : 'Tag cadastrada');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao salvar tag');
    }
    setSaving(false);
  };

  const editItem = (item: any) => {
    setEditingId(item.id);
    setForm({ name: item.name, color: item.color || '#4F46E5', sortOrder: item.sortOrder || 0 });
  };

  const removeItem = async (id: string) => {
    if (!window.confirm('Inativar esta tag?')) return;
    try {
      await api.deleteTag(id);
      await load();
      if (editingId === id) reset();
      toast.success('Tag inativada');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao inativar tag');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#8B5CF6,#6366F1)', boxShadow:'0 4px 14px rgba(99,102,241,0.3)' }}>
          <Tag className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="page-title">Tags</h1>
          <p className="page-subtitle">{items.length} tag{items.length !== 1 ? 's' : ''} cadastrada{items.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:'#EEF2FF' }}>
            <Plus className="w-4 h-4" style={{ color:'#4F46E5' }} />
          </div>
          <h2 className="table-header">{editingId ? 'Editar tag' : 'Nova tag'}</h2>
        </div>

        <form onSubmit={submit}>
          <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 140px 120px auto', gap:14, alignItems:'flex-end' }}>
            <div>
              <label style={lbl}>Nome</label>
              <input
                style={inp(focusField==='name')}
                value={form.name}
                required
                onFocus={() => setFocusField('name')}
                onBlur={() => setFocusField('')}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Ex: Premium, Urgente, Fiscal"
              />
            </div>
            <div>
              <label style={lbl}>Cor</label>
              <input
                type="color"
                value={form.color}
                onChange={(event) => setForm((prev) => ({ ...prev, color: event.target.value }))}
                style={{ ...inp(), height: 42, padding: 6 }}
              />
            </div>
            <div>
              <label style={lbl}>Ordem</label>
              <input
                type="number"
                style={inp(focusField==='order')}
                value={form.sortOrder}
                onFocus={() => setFocusField('order')}
                onBlur={() => setFocusField('')}
                onChange={(event) => setForm((prev) => ({ ...prev, sortOrder: Number(event.target.value) }))}
              />
            </div>
            <div style={{ display:'flex', gap:8 }}>
              {editingId && <button type="button" onClick={reset} className="btn-secondary">Cancelar</button>}
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Salvando...' : editingId ? 'Salvar' : 'Cadastrar'}</button>
            </div>
          </div>
        </form>
      </div>

      <div className="card overflow-hidden">
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', gap:10, background:'#FAFBFC' }}>
          <div style={{ width:30, height:30, borderRadius:8, background:'#EEF2FF', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Tag style={{ width:15, height:15, color:'#4F46E5' }} />
          </div>
          <h3 style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Tags cadastradas</h3>
          <span style={{ background:'#EEF2FF', color:'#4F46E5', padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>{items.length}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom:'1px solid #F1F5F9', background:'#FAFBFC' }}>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Nome</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Cor</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Ordem</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Status</th>
              <th className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding:24, textAlign:'center', color:'#94A3B8' }}>Carregando...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>Nenhuma tag cadastrada</td></tr>
            ) : items.map((item) => (
              <tr key={item.id} className="table-row">
                <td style={{ padding:'12px 16px', color:'#0F172A', fontWeight:600 }}>{item.name}</td>
                <td style={{ padding:'12px 16px' }}>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:8, fontSize:12, color:'#64748B' }}>
                    <span style={{ width:12, height:12, borderRadius:'50%', background:item.color || '#6366F1', border:'1px solid rgba(15,23,42,0.08)' }} />
                    {item.color || 'Padrão'}
                  </span>
                </td>
                <td style={{ padding:'12px 16px', color:'#94A3B8', fontSize:12 }}>{item.sortOrder || 0}</td>
                <td style={{ padding:'12px 16px' }}>
                  <span style={{ background:item.active ? '#DCFCE7' : '#FEE2E2', color:item.active ? '#15803D' : '#DC2626', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>
                    {item.active ? 'Ativa' : 'Inativa'}
                  </span>
                </td>
                <td style={{ padding:'12px 16px' }}>
                  <div style={{ display:'flex', gap:6 }}>
                    <button onClick={() => editItem(item)} className="btn-secondary" style={{ padding:'5px 7px' }}><Edit2 style={{ width:13, height:13 }} /></button>
                    {item.active && <button onClick={() => removeItem(item.id)} className="btn-danger" style={{ padding:'5px 7px' }}><Trash2 style={{ width:13, height:13 }} /></button>}
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
