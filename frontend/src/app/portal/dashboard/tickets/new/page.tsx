'use client';
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePortalStore } from '@/store/portal.store';
import { ArrowLeft, Send, Ticket } from 'lucide-react';

const lbl = { display:'block', color:'#475569', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 14px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

export default function PortalNewTicketPage() {
  const router = useRouter();
  const { client, contact, accessToken } = usePortalStore();
  const [tree, setTree] = useState<any>({ departments:[] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [focusField, setFocusField] = useState('');
  const [form, setForm] = useState({ subject:'', description:'', priority:'medium', department:'', category:'', subcategory:'', origin:'portal' });

  useEffect(() => {
    if (!accessToken) return;
    fetch('/api/v1/ticket-settings/tree', { headers:{ Authorization:`Bearer ${accessToken}` } })
      .then(r=>r.json())
      .then(d => setTree(d?.data || { departments:[] }))
      .catch(()=>{});
  }, [accessToken]);

  const departments = tree?.departments||[];
  const selectedDept = useMemo(()=>departments.find((d:any)=>d.name===form.department),[departments,form.department]);
  const categories = selectedDept?.categories||[];
  const selectedCat = useMemo(()=>categories.find((c:any)=>c.name===form.category),[categories,form.category]);
  const subcategories = selectedCat?.subcategories||[];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client?.id) { setError('Nenhuma empresa selecionada'); return; }
    if (!form.subject.trim() || !form.description.trim()) { setError('Preencha assunto e descrição'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/v1/tickets', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${accessToken}` },
        body: JSON.stringify({
          ...form,
          clientId: client.id,
          contactId: contact?.id,
          department: form.department||undefined,
          category: form.category||undefined,
          subcategory: form.subcategory||undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || data?.message || 'Erro ao criar ticket');
      const ticketId = data?.data?.id || data?.id;
      router.push(`/portal/dashboard/tickets/${ticketId}`);
    } catch(e:any){ setError(e.message||'Erro ao criar ticket'); }
    setSaving(false);
  };

  const Sel = ({ label, value, onChange, disabled, children }: any) => (
    <div>
      <label style={lbl}>{label}</label>
      <div style={{ position:'relative' }}>
        <select style={{ ...inp(), appearance:'none' as const, opacity:disabled?0.5:1, cursor:disabled?'not-allowed':'pointer' }}
          value={value} onChange={onChange} disabled={disabled}>
          {children}
        </select>
        <div style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none', color:'#CBD5E1', fontSize:10 }}>▼</div>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth:700 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
        <Link href="/portal/dashboard/tickets" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:36, height:36, background:'#fff', border:'1.5px solid #E2E8F0', borderRadius:10, color:'#475569', textDecoration:'none' }}>
          <ArrowLeft style={{ width:16, height:16 }} />
        </Link>
        <div>
          <h1 style={{ color:'#0F172A', fontSize:22, fontWeight:800, margin:0 }}>Novo Ticket</h1>
          <p style={{ color:'#94A3B8', fontSize:13, margin:0 }}>Descreva seu problema em detalhes</p>
        </div>
      </div>

      {error && (
        <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', marginBottom:16, color:'#DC2626', fontSize:13 }}>
          {error}
        </div>
      )}

      {/* Empresa selecionada */}
      {client && (
        <div style={{ background:'#EEF2FF', border:'1px solid #C7D2FE', borderRadius:12, padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:9, background:'linear-gradient(135deg,#6366F1,#4F46E5)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, color:'#fff', flexShrink:0 }}>
            {(client.tradeName||client.companyName||'?')[0].toUpperCase()}
          </div>
          <div>
            <p style={{ fontSize:13, fontWeight:700, color:'#1E1B4B', margin:0 }}>{client.tradeName||client.companyName}</p>
            <p style={{ fontSize:11, color:'#6366F1', margin:0 }}>Empresa selecionada</p>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} style={{ display:'flex', flexDirection:'column', gap:16 }}>
        <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, padding:24 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <label style={lbl}>Assunto <span style={{ color:'#6366F1' }}>*</span></label>
              <input value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})} required
                placeholder="Descreva brevemente o problema"
                onFocus={()=>setFocusField('sub')} onBlur={()=>setFocusField('')}
                style={inp(focusField==='sub')} />
            </div>
            <div>
              <label style={lbl}>Descrição <span style={{ color:'#6366F1' }}>*</span></label>
              <textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} required rows={5}
                placeholder="Detalhe o problema, mensagens de erro, passos para reproduzir..."
                onFocus={()=>setFocusField('desc')} onBlur={()=>setFocusField('')}
                style={{ ...inp(focusField==='desc'), resize:'vertical' as const }} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <Sel label="Prioridade" value={form.priority} onChange={(e:any)=>setForm({...form,priority:e.target.value})}>
                <option value="low">🟢 Baixa</option>
                <option value="medium">🔵 Média</option>
                <option value="high">🟠 Alta</option>
                <option value="critical">🔴 Crítica</option>
              </Sel>
              <Sel label="Departamento" value={form.department} onChange={(e:any)=>setForm({...form,department:e.target.value,category:'',subcategory:''})}>
                <option value="">Selecione</option>
                {departments.map((d:any)=><option key={d.id} value={d.name}>{d.name}</option>)}
              </Sel>
              {form.department && (
                <Sel label="Categoria" value={form.category} disabled={!form.department} onChange={(e:any)=>setForm({...form,category:e.target.value,subcategory:''})}>
                  <option value="">Selecione</option>
                  {categories.map((c:any)=><option key={c.id} value={c.name}>{c.name}</option>)}
                </Sel>
              )}
              {form.category && (
                <Sel label="Subcategoria" value={form.subcategory} disabled={!form.category} onChange={(e:any)=>setForm({...form,subcategory:e.target.value})}>
                  <option value="">Selecione</option>
                  {subcategories.map((s:any)=><option key={s.id} value={s.name}>{s.name}</option>)}
                </Sel>
              )}
            </div>
          </div>
        </div>

        <div style={{ display:'flex', justifyContent:'flex-end', gap:12 }}>
          <Link href="/portal/dashboard/tickets" style={{ padding:'10px 20px', background:'#fff', border:'1.5px solid #E2E8F0', borderRadius:10, color:'#475569', fontSize:14, fontWeight:600, textDecoration:'none', display:'inline-flex', alignItems:'center' }}>
            Cancelar
          </Link>
          <button type="submit" disabled={saving}
            style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 24px', background:'linear-gradient(135deg,#4F46E5,#6366F1)', border:'none', borderRadius:10, color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer', boxShadow:'0 4px 14px rgba(99,102,241,0.35)', opacity:saving?0.7:1 }}>
            <Send style={{ width:15, height:15 }} /> {saving?'Enviando...':'Abrir Ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}
