'use client';
import { FormEvent, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Search, X, User, Building2, FileText, ChevronDown, AlertCircle, Ticket, Tag, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { TagMultiSelect } from '@/components/ui/TagMultiSelect';

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 14px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

const SECTION = ({ title, icon: Icon, color, children }: any) => (
  <div className="card p-5">
    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
      <div style={{ width:32, height:32, borderRadius:10, background:color+'15', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <Icon style={{ width:16, height:16, color }} />
      </div>
      <h2 style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>{title}</h2>
    </div>
    {children}
  </div>
);

export default function NewTicketPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [tree, setTree] = useState<any>({ departments:[] });
  const [availableTags, setAvailableTags] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [focusField, setFocusField] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({ clientId:'', contactId:'', contractId:'', assignedTo:'', origin:'internal', priority:'medium', department:'', category:'', subcategory:'', subject:'', description:'', tags:[] as string[] });

  useEffect(() => {
    const load = async () => {
      try {
        const [cr, tr, treeR, conR, tagR] = await Promise.all([api.getCustomers({ perPage:500 }), api.getTeam(), api.getTicketSettingsTree(), api.getContracts(), api.getTags({ active: true })]);
        setCustomers(cr?.data||cr||[]); setTeam(tr||[]); setTree(treeR||{departments:[]}); setContracts(Array.isArray(conR)?conR:conR?.data||[]); setAvailableTags(Array.isArray(tagR)?tagR:tagR?.data||[]);
      } catch(e){ console.error(e); }
    };
    load();
  }, []);

  useEffect(() => {
    const handler = (e:MouseEvent) => { if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredCustomers = useMemo(() => {
    if (clientSearch.length < 3) return [];
    const q = clientSearch.toLowerCase();
    return customers.filter((c:any) => (c.tradeName||c.companyName||'').toLowerCase().includes(q) || (c.cnpj||'').replace(/\D/g,'').includes(q.replace(/\D/g,''))).slice(0,10);
  }, [clientSearch, customers]);

  const selectClient = async (client:any) => {
    setSelectedClient(client); setForm(f=>({...f,clientId:client.id,contactId:'',contractId:''})); setClientSearch(''); setShowDropdown(false);
    setLoadingContacts(true);
    try { setContacts(await api.getContacts(client.id)||[]); } catch { setContacts([]); }
    setLoadingContacts(false);
  };

  const clearClient = () => { setSelectedClient(null); setForm(f=>({...f,clientId:'',contactId:'',contractId:''})); setContacts([]); setClientSearch(''); };

  const departments = tree?.departments||[];
  const selectedDept = useMemo(()=>departments.find((d:any)=>d.name===form.department),[departments,form.department]);
  const categories = selectedDept?.categories||[];
  const selectedCat = useMemo(()=>categories.find((c:any)=>c.name===form.category),[categories,form.category]);
  const subcategories = selectedCat?.subcategories||[];
  const clientContracts = useMemo(()=>contracts.filter((c:any)=>c.clientId===form.clientId&&c.status==='active'),[contracts,form.clientId]);

  const fmtCNPJ = (v:string) => { if(!v) return ''; const n=v.replace(/\D/g,''); return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'); };

  const onSubmit = async (e:FormEvent) => {
    e.preventDefault();
    if (!form.clientId) { toast.error('Selecione um cliente'); return; }
    if (!form.contactId) { toast.error('Selecione um contato da empresa'); return; }
    setSaving(true);
    try {
      const payload = { ...form, contactId:form.contactId||undefined, contractId:form.contractId||undefined, assignedTo:form.assignedTo||undefined, department:form.department||undefined, category:form.category||undefined, subcategory:form.subcategory||undefined, tags:form.tags.length?form.tags:undefined };
      const created = await api.createTicket(payload);
      router.push(`/dashboard/tickets/${created.id}`);
    } catch(e:any){ toast.error(e?.response?.data?.message||'Erro ao criar ticket'); }
    setSaving(false);
  };

  const Sel = ({ label, value, onChange, disabled, required, children }: any) => (
    <div>
      <label style={lbl}>{label}{required&&<span style={{color:'#6366F1',marginLeft:3}}>*</span>}</label>
      <div style={{ position:'relative' }}>
        <select style={{ ...inp(), appearance:'none' as const, opacity:disabled?0.5:1, cursor:disabled?'not-allowed':'pointer' }}
          value={value} onChange={onChange} disabled={disabled} required={required}>
          {children}
        </select>
        <ChevronDown style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', width:14, height:14, color:'#CBD5E1', pointerEvents:'none' }} />
      </div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <Link href="/dashboard/tickets" className="btn-secondary" style={{ padding:'8px 10px' }}>
            <ArrowLeft style={{ width:16, height:16 }} />
          </Link>
          <div>
            <h1 className="page-title">Novo Ticket</h1>
            <p className="page-subtitle">Abra um novo chamado de suporte</p>
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} style={{ display:'flex', flexDirection:'column', gap:16 }}>

        {/* Cliente */}
        <SECTION title="Cliente" icon={Building2} color="#4F46E5">
          <div ref={searchRef} style={{ position:'relative', marginBottom:16 }}>
            <label style={lbl}>Buscar cliente <span style={{color:'#6366F1'}}>*</span> <span style={{color:'#CBD5E1',fontWeight:400,textTransform:'none',fontSize:11}}>(mínimo 3 caracteres)</span></label>

            {selectedClient ? (
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', background:'#EEF2FF', border:'1.5px solid #C7D2FE', borderRadius:12 }}>
                <div style={{ width:40, height:40, borderRadius:10, background:'linear-gradient(135deg,#6366F1,#4F46E5)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700, color:'#fff', flexShrink:0 }}>
                  {(selectedClient.tradeName||selectedClient.companyName||'?')[0].toUpperCase()}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:14, fontWeight:700, color:'#0F172A', margin:0 }}>{selectedClient.tradeName||selectedClient.companyName}</p>
                  {selectedClient.cnpj && <p style={{ fontSize:12, color:'#6366F1', margin:'2px 0 0' }}>{fmtCNPJ(selectedClient.cnpj)}</p>}
                </div>
                <button type="button" onClick={clearClient} style={{ background:'#fff', border:'1px solid #C7D2FE', borderRadius:8, padding:6, cursor:'pointer', color:'#6366F1', display:'flex' }}>
                  <X style={{ width:14, height:14 }} />
                </button>
              </div>
            ) : (
              <>
                <div style={{ position:'relative' }}>
                  <Search style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', width:15, height:15, color:'#CBD5E1' }} />
                  <input value={clientSearch} onChange={e=>{ setClientSearch(e.target.value); setShowDropdown(true); }}
                    onFocus={()=>clientSearch.length>=3&&setShowDropdown(true)}
                    placeholder="Digite o nome ou CNPJ do cliente..." style={{ ...inp(focusField==='client'), paddingLeft:40 }}
                    onFocus={()=>setFocusField('client')} onBlur={()=>setFocusField('')} />
                  {clientSearch && <button type="button" onClick={()=>{setClientSearch('');setShowDropdown(false);}} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94A3B8', display:'flex' }}><X style={{width:14,height:14}} /></button>}
                </div>
                {clientSearch.length>0&&clientSearch.length<3&&<p style={{fontSize:11,color:'#94A3B8',marginTop:4}}>Digite mais {3-clientSearch.length} caractere(s)</p>}
                {showDropdown&&clientSearch.length>=3&&(
                  <div style={{ position:'absolute', top:'100%', left:0, right:0, marginTop:4, background:'#fff', border:'1.5px solid #E2E8F0', borderRadius:12, zIndex:100, boxShadow:'0 10px 40px rgba(0,0,0,0.12)', overflow:'hidden' }}>
                    {filteredCustomers.length===0 ? (
                      <div style={{ padding:'14px 16px', fontSize:13, color:'#94A3B8', display:'flex', alignItems:'center', gap:8 }}>
                        <AlertCircle style={{width:14,height:14}} /> Nenhum cliente encontrado
                      </div>
                    ) : filteredCustomers.map((c:any) => (
                      <button key={c.id} type="button" onClick={()=>selectClient(c)}
                        style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', width:'100%', background:'transparent', border:'none', borderBottom:'1px solid #F1F5F9', cursor:'pointer', textAlign:'left' as const, transition:'background 0.1s' }}
                        onMouseEnter={e=>e.currentTarget.style.background='#F8FAFC'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                        <div style={{ width:36, height:36, borderRadius:9, background:'linear-gradient(135deg,#6366F1,#4F46E5)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#fff', flexShrink:0 }}>
                          {(c.tradeName||c.companyName||'?')[0].toUpperCase()}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <p style={{ fontSize:13, fontWeight:600, color:'#0F172A', margin:0 }}>{c.tradeName||c.companyName}</p>
                          <div style={{ display:'flex', gap:12, marginTop:2 }}>
                            {c.cnpj&&<p style={{fontSize:11,color:'#94A3B8',margin:0}}>{fmtCNPJ(c.cnpj)}</p>}
                            {c.city&&<p style={{fontSize:11,color:'#94A3B8',margin:0}}>{c.city}/{c.state}</p>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {selectedClient && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div>
                <label style={lbl}><User style={{width:11,height:11,display:'inline',marginRight:4}} />Contato</label>
                <div style={{ position:'relative' }}>
                  <select style={{ ...inp(), appearance:'none' as const }} value={form.contactId} onChange={e=>setForm({...form,contactId:e.target.value})}>
                    <option value="">{loadingContacts?'Carregando...':'Selecione o contato'}</option>
                    {contacts.map((c:any)=><option key={c.id} value={c.id}>{c.name}{c.role?` — ${c.role}`:''}</option>)}
                  </select>
                  <ChevronDown style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',width:14,height:14,color:'#CBD5E1',pointerEvents:'none'}} />
                </div>
              </div>
              <div>
                <label style={lbl}><FileText style={{width:11,height:11,display:'inline',marginRight:4}} />Contrato</label>
                <div style={{ position:'relative' }}>
                  <select style={{ ...inp(), appearance:'none' as const }} value={form.contractId} onChange={e=>setForm({...form,contractId:e.target.value})}>
                    <option value="">Sem contrato</option>
                    {clientContracts.map((c:any)=>{ const t:Record<string,string>={monthly:'Mensal',hours_bank:'Banco de Horas',on_demand:'Sob Demanda',warranty:'Garantia'}; return <option key={c.id} value={c.id}>{t[c.contractType]||c.contractType} — SLA {c.slaResolveHours}h</option>; })}
                  </select>
                  <ChevronDown style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',width:14,height:14,color:'#CBD5E1',pointerEvents:'none'}} />
                </div>
                {clientContracts.length===0&&<p style={{fontSize:11,color:'#94A3B8',marginTop:4}}>Nenhum contrato ativo</p>}
              </div>
            </div>
          )}
        </SECTION>

        {/* Ticket Info */}
        <SECTION title="Informações do Ticket" icon={Ticket} color="#3B82F6">
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <label style={lbl}>Assunto <span style={{color:'#6366F1'}}>*</span></label>
              <input value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})} required
                placeholder="Descreva brevemente o problema" onFocus={()=>setFocusField('subject')} onBlur={()=>setFocusField('')}
                style={inp(focusField==='subject')} />
            </div>
            <div>
              <label style={lbl}>Descrição <span style={{color:'#6366F1'}}>*</span></label>
              <textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} required rows={4}
                placeholder="Detalhe o problema, incluindo passos para reproduzir, erros, etc."
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
              <Sel label="Origem" value={form.origin} onChange={(e:any)=>setForm({...form,origin:e.target.value})}>
                <option value="internal">Interno</option>
                <option value="portal">Portal</option>
                <option value="email">E-mail</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="phone">Telefone</option>
              </Sel>
              <Sel label="Departamento" value={form.department} onChange={(e:any)=>setForm({...form,department:e.target.value,category:'',subcategory:''})}>
                <option value="">Selecione</option>
                {departments.map((d:any)=><option key={d.id} value={d.name}>{d.name}</option>)}
              </Sel>
              <Sel label="Categoria" value={form.category} disabled={!form.department} onChange={(e:any)=>setForm({...form,category:e.target.value,subcategory:''})}>
                <option value="">Selecione</option>
                {categories.map((c:any)=><option key={c.id} value={c.name}>{c.name}</option>)}
              </Sel>
              <Sel label="Subcategoria" value={form.subcategory} disabled={!form.category} onChange={(e:any)=>setForm({...form,subcategory:e.target.value})}>
                <option value="">Selecione</option>
                {subcategories.map((s:any)=><option key={s.id} value={s.name}>{s.name}</option>)}
              </Sel>
              <Sel label="Técnico responsável" value={form.assignedTo} onChange={(e:any)=>setForm({...form,assignedTo:e.target.value})}>
                <option value="">Não atribuído</option>
                {team.map((u:any)=><option key={u.id} value={u.id}>{u.name||u.email}</option>)}
              </Sel>
            </div>
            <div>
              <label style={lbl}><Tag style={{width:10,height:10,display:'inline',marginRight:4}} />Tags</label>
              <TagMultiSelect
                options={availableTags}
                value={form.tags}
                onChange={(tags) => setForm({ ...form, tags })}
                placeholder="Selecione as tags do ticket"
                emptyText="Nenhuma tag cadastrada"
              />
            </div>
          </div>
        </SECTION>

        {/* Botões */}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:12, paddingBottom:24 }}>
          <Link href="/dashboard/tickets" className="btn-secondary">Cancelar</Link>
          <button type="submit" disabled={saving||!form.clientId} className="btn-primary"
            style={{ minWidth:160, justifyContent:'center', opacity:(!form.clientId||saving)?0.6:1 }}>
            {saving?'Criando ticket...':'Criar Ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}

