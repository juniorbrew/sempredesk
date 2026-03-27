'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { ArrowLeft, Save, Plus, Trash2, User, MapPin, Building2, CheckCircle2, Network, Lock, Edit2, Phone, Mail, MessageCircle, Star, Eye, EyeOff, KeyRound, ExternalLink, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

// ── Países para seleção de DDI ──────────────────────────────────────────────
const COUNTRIES = [
  { code:'+55', flag:'🇧🇷', name:'Brasil' },
  { code:'+1',  flag:'🇺🇸', name:'EUA / Canadá' },
  { code:'+54', flag:'🇦🇷', name:'Argentina' },
  { code:'+351',flag:'🇵🇹', name:'Portugal' },
  { code:'+34', flag:'🇪🇸', name:'Espanha' },
  { code:'+44', flag:'🇬🇧', name:'Reino Unido' },
  { code:'+49', flag:'🇩🇪', name:'Alemanha' },
  { code:'+33', flag:'🇫🇷', name:'França' },
  { code:'+39', flag:'🇮🇹', name:'Itália' },
  { code:'+52', flag:'🇲🇽', name:'México' },
  { code:'+56', flag:'🇨🇱', name:'Chile' },
  { code:'+57', flag:'🇨🇴', name:'Colômbia' },
  { code:'+51', flag:'🇵🇪', name:'Peru' },
  { code:'+58', flag:'🇻🇪', name:'Venezuela' },
  { code:'+598',flag:'🇺🇾', name:'Uruguai' },
  { code:'+595',flag:'🇵🇾', name:'Paraguai' },
  { code:'+591',flag:'🇧🇴', name:'Bolívia' },
  { code:'+81', flag:'🇯🇵', name:'Japão' },
  { code:'+86', flag:'🇨🇳', name:'China' },
  { code:'+91', flag:'🇮🇳', name:'Índia' },
];

/** Dado um número completo armazenado, extrai o DDI e o número local */
function parsePhone(full: string): { country: string; local: string } {
  const digits = (full || '').replace(/\D/g,'');
  if (!digits) return { country: '+55', local: '' };
  // IMPORTANTE: usar cópia do array — COUNTRIES.sort() mutaria o array global e quebraria o dropdown
  for (const c of [...COUNTRIES].sort((a,b) => b.code.length - a.code.length)) {
    const ddi = c.code.replace('+','');
    if (digits.startsWith(ddi)) {
      const local = digits.slice(ddi.length);
      // Número local deve ter entre 7 e 13 dígitos (evita DDI+1 "engolir" números longos)
      if (local.length >= 7 && local.length <= 13) {
        return { country: c.code, local };
      }
    }
  }
  // Fallback: devolve Brasil e o número completo (sem DDI identificado)
  return { country: '+55', local: digits };
}

/** Monta número completo: DDI + número local (remove não-dígitos do local) */
function composePhone(country: string, local: string): string {
  const localDigits = local.replace(/\D/g,'');
  if (!localDigits) return '';
  return country.replace('+','') + localDigits;
}

const fmtCnpj = (v: string) => { const d=(v||'').replace(/\D/g,'').slice(0,14); return d.replace(/^(\d{2})(\d)/,'$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/,'$1.$2.$3').replace(/\.(\d{3})(\d)/,'.$1/$2').replace(/(\d{4})(\d)/,'$1-$2'); };
const rawCnpj = (v: string) => v.replace(/\D/g,'');
const fmtCpf = (v: string) => { const d=(v||'').replace(/\D/g,'').slice(0,11); return d.replace(/^(\d{3})(\d)/,'$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/,'$1.$2.$3').replace(/(\d{3})(\d{1,2})$/,'$1-$2'); };
const rawCpf = (v: string) => v.replace(/\D/g,'');
function validateCpfAlgo(cpf: string): boolean {
  const raw=cpf.replace(/\D/g,''); if(raw.length!==11||/^(\d)\1{10}$/.test(raw)) return false;
  let s=0; for(let i=0;i<9;i++) s+=parseInt(raw[i])*(10-i); let r=11-(s%11); if(r>=10) r=0; if(r!==parseInt(raw[9])) return false;
  s=0; for(let i=0;i<10;i++) s+=parseInt(raw[i])*(11-i); r=11-(s%11); if(r>=10) r=0; return r===parseInt(raw[10]);
}
function validateCnpjAlgo(cnpj: string): boolean {
  const raw=cnpj.replace(/\D/g,''); if(raw.length!==14||/^(\d)\1{13}$/.test(raw)) return false;
  const calc=(w: number[])=>{ let s=0; for(let i=0;i<w.length;i++) s+=parseInt(raw[i])*w[i]; const m=s%11; return m<2?0:11-m; };
  return calc([5,4,3,2,9,8,7,6,5,4,3,2])===parseInt(raw[12])&&calc([6,5,4,3,2,9,8,7,6,5,4,3,2])===parseInt(raw[13]);
}
const PLANS = ['enterprise','premium','standard','basic'];
const PLAN_LABELS: Record<string,string> = { enterprise:'Enterprise', premium:'Premium', standard:'Standard', basic:'Básico' };
const PLAN_COLORS: Record<string,string> = { enterprise:'#7C3AED', premium:'#D97706', standard:'#2563EB', basic:'#64748B' };
const PLAN_BG: Record<string,string> = { enterprise:'#F5F3FF', premium:'#FFFBEB', standard:'#EFF6FF', basic:'#F8FAFC' };
const STATES = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

// ── Helpers: separação LID técnico vs número visível ─────────────────────────
/** True se o whatsapp armazenado é um LID técnico (não é número de telefone visível) */
function isTechnicalWhatsapp(contact: any): boolean {
  if (!contact?.whatsapp) return false;
  const digits = (contact.whatsapp as string).replace(/\D/g, '');
  if (contact.metadata?.whatsappLid === contact.whatsapp) return true;
  if (digits.length >= 14 && !contact.phone) return true;
  return false;
}
/** Retorna o número visível/negocial — nunca retorna LID */
function getVisibleWhatsapp(contact: any): string {
  if (!contact?.whatsapp) return '';
  return isTechnicalWhatsapp(contact) ? '' : contact.whatsapp;
}
/** Retorna o identificador técnico LID do contato */
function getTechnicalWhatsapp(contact: any): string {
  if (contact?.metadata?.whatsappLid) return contact.metadata.whatsappLid as string;
  if (isTechnicalWhatsapp(contact)) return contact.whatsapp ?? '';
  return '';
}
/** True se o contato tem canal WhatsApp (visível ou técnico) */
function hasWhatsappChannel(contact: any): boolean {
  return !!getVisibleWhatsapp(contact) || !!getTechnicalWhatsapp(contact);
}

export default function CustomerDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [customer, setCustomer] = useState<any>(null);
  const [network, setNetwork] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dados'|'contatos'|'conversas'>(
    (searchParams.get('tab') === 'contatos' ? 'contatos' : searchParams.get('tab') === 'conversas' ? 'conversas' : 'dados') as any
  );
  const [conversations, setConversations] = useState<any[]>([]);
  const [startingConv, setStartingConv] = useState<string | null>(null);
  const [form, setForm] = useState<any>({});
  const [focusField, setFocusField] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState<any>(null);
  const [contactForm, setContactForm] = useState({ name:'', role:'', email:'', phone:'', phoneCountry:'+55', whatsapp:'', whatsappCountry:'+55', notes:'', isPrimary:false, password:'', technicalWhatsapp:'' });
  const [showContactPass, setShowContactPass] = useState(false);
  const [emailSearching, setEmailSearching] = useState(false);
  const [focusCF, setFocusCF] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [showPhoneCountry, setShowPhoneCountry] = useState(false);
  const [showWhatsCountry, setShowWhatsCountry] = useState(false);
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [allNetworks, setAllNetworks] = useState<any[]>([]);
  const [networkModalSearch, setNetworkModalSearch] = useState('');
  const [changingNetwork, setChangingNetwork] = useState(false);
  const [cnpjStatus, setCnpjStatus] = useState<'idle'|'loading'|'ok'|'error'>('idle');
  const [cpfStatus, setCpfStatus] = useState<'idle'|'ok'|'error'>('idle');
  const cnpjTimer = (typeof window !== 'undefined' ? { current: null as any } : { current: null as any });

  const load = async () => {
    setLoading(true);
    try {
      const res: any = await api.getCustomer(id as string);
      setCustomer(res); setForm(res); setContacts(res.contacts || []);
      if (res.networkId) { try { const n: any = await api.getNetwork(res.networkId); setNetwork(n); } catch {} }
    } catch { router.push('/dashboard/customers'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    if (id && activeTab === 'conversas') {
      api.getConversationsByClient(id as string).then((r: any) =>
        setConversations(Array.isArray(r) ? r : r?.data ?? [])
      ).catch(() => setConversations([]));
    }
  }, [id, activeTab]);

  const openNetworkModal = async () => {
    setNetworkModalSearch('');
    if (!allNetworks.length) {
      try { const r: any = await api.getNetworks(); setAllNetworks(r.data || []); } catch {}
    }
    setShowNetworkModal(true);
  };

  const handleChangeNetwork = async (net: any) => {
    setChangingNetwork(true);
    try {
      await api.changeCustomerNetwork(id as string, net.id);
      setNetwork(net); setForm((p: any) => ({ ...p, networkId: net.id }));
      setShowNetworkModal(false);
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao trocar rede'); }
    setChangingNetwork(false);
  };

  const handleCnpjChange = (v: string) => {
    const fmt = fmtCnpj(v);
    setForm((p: any) => ({ ...p, cnpj: fmt }));
    clearTimeout(cnpjTimer.current);
    const raw = rawCnpj(fmt);
    if (raw.length === 14) {
      if (!validateCnpjAlgo(raw)) { setCnpjStatus('error'); return; }
      setCnpjStatus('loading');
      cnpjTimer.current = setTimeout(async () => {
        try {
          const r: any = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${raw}`).then(x => x.json());
          if (r.razao_social) {
            setForm((p: any) => ({ ...p, companyName: r.razao_social||p.companyName, tradeName: r.nome_fantasia||p.tradeName, email: r.email||p.email, phone: r.ddd_telefone_1||p.phone, address: r.logradouro||p.address, number: r.numero||p.number, complement: r.complemento||p.complement, neighborhood: r.bairro||p.neighborhood, city: r.municipio||p.city, state: r.uf||p.state, zipCode: r.cep?.replace(/\D/g,'').replace(/(\d{5})(\d{3})/,'$1-$2')||p.zipCode }));
            setCnpjStatus('ok');
          } else setCnpjStatus('error');
        } catch { setCnpjStatus('error'); }
      }, 600);
    } else setCnpjStatus('idle');
  };

  const handleCpfChange = (v: string) => {
    const fmt = fmtCpf(v);
    setForm((p: any) => ({ ...p, cpf: fmt }));
    const raw = rawCpf(fmt);
    if (raw.length === 11) setCpfStatus(validateCpfAlgo(raw) ? 'ok' : 'error');
    else setCpfStatus('idle');
  };

  const f = (k:string) => (e:any) => setForm((p:any) => ({ ...p, [k]: e.target.value }));
  const fc = (k:string) => (e:any) => setContactForm((p:any) => ({ ...p, [k]: e.target.value }));
  const nxt = (nextId?:string) => (e:any) => { if (e.key==='Enter') { e.preventDefault(); if (nextId) document.getElementById(nextId)?.focus(); else handleSave(); }};
  const nxtC = (nextId?:string) => (e:any) => { if (e.key==='Enter') { e.preventDefault(); if (nextId) document.getElementById(nextId)?.focus(); else handleSaveContact(); }};

  const handleSave = async () => {
    if (!form.companyName?.trim()) { setError('Razão Social é obrigatória'); return; }
    const personType = form.personType || 'juridica';
    if (personType === 'juridica' && form.cnpj && rawCnpj(form.cnpj).length === 14 && !validateCnpjAlgo(rawCnpj(form.cnpj))) {
      setError('CNPJ inválido'); return;
    }
    if (personType === 'fisica' && form.cpf && rawCpf(form.cpf).length === 11 && !validateCpfAlgo(rawCpf(form.cpf))) {
      setError('CPF inválido'); return;
    }
    setSaving(true); setError(''); setSuccess(false);
    try {
      const payload: any = { ...form, personType };
      if (personType === 'juridica') { payload.cnpj = rawCnpj(form.cnpj||''); delete payload.cpf; }
      else { payload.cpf = rawCpf(form.cpf||''); delete payload.cnpj; }
      const res: any = await api.updateCustomer(id as string, payload);
      setCustomer(res); setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e:any) { setError(e?.response?.data?.message || 'Erro ao salvar'); }
    setSaving(false);
  };

  const openContactModal = (c?:any) => {
    setEditingContact(c || null);
    if (c) {
      const ph = parsePhone(c.phone || '');
      const visibleWa = getVisibleWhatsapp(c);
      const wa = parsePhone(visibleWa);
      const techWa = getTechnicalWhatsapp(c);
      setContactForm({ name:c.name, role:c.role||'', email:c.email||'', phone:ph.local, phoneCountry:ph.country, whatsapp:wa.local, whatsappCountry:wa.country, notes:c.notes||'', isPrimary:c.isPrimary||false, password:'', technicalWhatsapp:techWa });
    } else {
      setContactForm({ name:'', role:'', email:'', phone:'', phoneCountry:'+55', whatsapp:'', whatsappCountry:'+55', notes:'', isPrimary:false, password:'', technicalWhatsapp:'' });
    }
    setShowContactPass(false);
    
    setShowContactModal(true);
    setTimeout(() => document.getElementById('cm_email')?.focus(), 100);
  };

  /** Gera senha aleatória segura */
  const generatePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789@#!';
    let pwd = '';
    for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    setContactForm(p => ({ ...p, password: pwd }));
    setShowContactPass(true);
  };

  const handleSaveContact = async () => {
    if (!contactForm.name.trim()) return;
    setSavingContact(true);
    try {
      const { password, phoneCountry, whatsappCountry, technicalWhatsapp, ...rest } = contactForm;
      // Monta números completos com DDI
      const phoneComplete = composePhone(phoneCountry, rest.phone);
      const whatsComplete = composePhone(whatsappCountry, rest.whatsapp);
      const clean: any = Object.fromEntries(Object.entries({ ...rest, phone: phoneComplete, whatsapp: whatsComplete }).filter(([_, v]) => v !== '' && v !== null));
      // Preserva LID: se o campo visível ficou vazio mas há identificador técnico, mantém routing
      if (editingContact && !whatsComplete && technicalWhatsapp) {
        clean.whatsapp = technicalWhatsapp;
      }
      // Persiste o LID em metadata para separação técnica
      if (editingContact && technicalWhatsapp) {
        clean.metadata = { ...(editingContact.metadata ?? {}), whatsappLid: technicalWhatsapp };
      }
      // Inclui senha: ao criar sempre (gerar automaticamente se vazio); ao editar só se preenchido
      if (password) {
        clean.password = password;
      } else if (!editingContact) {
        // Novo contato sem senha: gera automaticamente para habilitar acesso ao portal
        const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789@#!';
        let pwd = '';
        for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
        clean.password = pwd;
      }
      if (editingContact) await api.updateContact(id as string, editingContact.id, clean);
      else await api.createContact(id as string, clean);
      setShowContactModal(false); load();
    } catch(e: any) { toast.error(e?.response?.data?.message || 'Erro ao salvar contato'); }
    setSavingContact(false);
  };

  const handleRemoveContact = async (contactId:string) => {
    if (!confirm('Remover contato?')) return;
    try { await api.removeContact(id as string, contactId); load(); } catch {}
  };

  const handleStartWhatsappConversation = async (contactId: string) => {
    setStartingConv(contactId);
    try {
      await api.startAgentConversation({ clientId: id as string, contactId, channel: 'whatsapp' });
      if (activeTab === 'conversas') {
        api.getConversationsByClient(id as string).then((r: any) =>
          setConversations(Array.isArray(r) ? r : r?.data ?? [])
        ).catch(() => {});
      }
      router.push('/dashboard/atendimento');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao iniciar conversa');
    }
    setStartingConv(null);
  };

  const inp = (focus?:boolean) => ({
    width:'100%', padding:'9px 12px',
    background: focus ? '#fff' : '#F8FAFC',
    border: `1.5px solid ${focus ? '#4F46E5' : '#E2E8F0'}`,
    borderRadius: 8, color:'#0F172A', fontSize:14, outline:'none',
    boxSizing:'border-box' as const,
    boxShadow: focus ? '0 0 0 3px rgba(79,70,229,0.1)' : 'none',
    transition:'all 0.15s'
  });

  const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:600 as const, letterSpacing:'0.06em', marginBottom:5, textTransform:'uppercase' as const };

  if (loading) return (
    <div className="flex items-center justify-center min-h-96">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm" style={{ color:'#94A3B8' }}>Carregando...</p>
      </div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.push('/dashboard/customers')}
          className="btn-secondary" style={{ padding:'8px 10px' }}>
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title text-lg">Editar Cliente</h1>
            <span style={{ background:'#EEF2FF', color:'#4F46E5', padding:'2px 8px', borderRadius:5, fontSize:11, fontFamily:'monospace', fontWeight:700 }}>#{customer?.code}</span>
            {network && (
              <span className="flex items-center gap-1.5" style={{ background:'#EEF2FF', color:'#4F46E5', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600, border:'1px solid #C7D2FE' }}>
                <Network className="w-3 h-3" /> {network.name}
              </span>
            )}
          </div>
          <p className="page-subtitle">{customer?.companyName}</p>
        </div>
        {/* Tabs */}
        <div className="flex" style={{ background:'#F1F5F9', borderRadius:10, padding:3, gap:2 }}>
          {[['dados','Dados'],['contatos',`Contatos (${contacts.length})`],['conversas',`Conversas (${conversations.length})`]].map(([tab,label]) => (
            <button key={tab} onClick={() => setActiveTab(tab as any)}
              title={tab === 'conversas' ? 'Conversas WhatsApp e Portal do cliente' : undefined}
              style={{ padding:'7px 18px', border:'none', cursor:'pointer', fontSize:13, fontWeight:500, borderRadius:8, background:activeTab===tab?'#fff':'transparent', color:activeTab===tab?'#0F172A':'#64748B', boxShadow:activeTab===tab?'0 1px 3px rgba(0,0,0,0.1)':'none', transition:'all 0.15s' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg text-sm" style={{ background:'#FEF2F2', color:'#DC2626', border:'1px solid #FECACA' }}>
          <span>⚠</span> {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg text-sm" style={{ background:'#F0FDF4', color:'#16A34A', border:'1px solid #BBF7D0' }}>
          <CheckCircle2 className="w-4 h-4" /> Alterações salvas com sucesso!
        </div>
      )}

      {/* ABA DADOS */}
      {activeTab === 'dados' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 360px', gap:20 }}>
          <div className="flex flex-col gap-4">

            {/* Rede vinculada */}
            <div className="card p-4 flex items-center gap-3" style={{ border:`1px solid ${network?'#C7D2FE':'#E2E8F0'}`, background:network?'#EEF2FF':'#F8FAFC' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: network?'linear-gradient(135deg,#4F46E5,#6366F1)':'#E2E8F0' }}>
                <Network className="w-5 h-5" style={{ color: network?'#fff':'#94A3B8' }} />
              </div>
              <div className="flex-1">
                <div style={{ color:'#6366F1', fontSize:10, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:1 }}>Rede Vinculada</div>
                {network ? (
                  <>
                    <div style={{ color:'#1E1B4B', fontWeight:700, fontSize:15 }}>{network.name}</div>
                    <div style={{ color:'#6366F1', fontSize:12, opacity:0.7 }}>#{network.code}{network.responsible ? ` · ${network.responsible}` : ''}</div>
                  </>
                ) : (
                  <div style={{ color:'#94A3B8', fontSize:13 }}>Nenhuma rede vinculada</div>
                )}
              </div>
              <button onClick={openNetworkModal}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', background:'#fff', border:'1px solid #C7D2FE', borderRadius:8, color:'#4F46E5', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                <RefreshCw className="w-3.5 h-3.5" /> Trocar Rede
              </button>
            </div>

            {/* Dados da empresa */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:'#EFF6FF' }}>
                  <Building2 className="w-4 h-4" style={{ color:'#2563EB' }} />
                </div>
                <h2 className="table-header">Dados da Empresa</h2>
              </div>
              {/* Tipo de pessoa */}
              <div style={{ display:'flex', gap:8, marginBottom:2 }}>
                {[['juridica','Pessoa Jurídica (CNPJ)'],['fisica','Pessoa Física (CPF)']].map(([v,l]) => (
                  <button key={v} onClick={() => { setForm((p: any) => ({ ...p, personType: v, cnpj: '', cpf: '' })); setCnpjStatus('idle'); setCpfStatus('idle'); }}
                    style={{ flex:1, padding:'7px 0', borderRadius:8, border:`1.5px solid ${(form.personType||'juridica')===v?'#4F46E5':'#E2E8F0'}`, background:(form.personType||'juridica')===v?'#EEF2FF':'transparent', color:(form.personType||'juridica')===v?'#4F46E5':'#64748B', fontSize:12, cursor:'pointer', fontWeight:(form.personType||'juridica')===v?700:400, transition:'all 0.15s' }}>
                    {l}
                  </button>
                ))}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                <div>
                  <label style={lbl}>Código</label>
                  <input value={form.code||''} readOnly onFocus={() => setFocusField('code')} onBlur={() => setFocusField('')}
                    style={{ ...inp(false), background:'#F1F5F9', color:'#94A3B8', cursor:'not-allowed' }}
                    title="O código do cliente é gerado automaticamente e não pode ser alterado" />
                </div>
                {(form.personType||'juridica') === 'juridica' ? (
                <div>
                  <label style={lbl}>CNPJ</label>
                  <div style={{ position:'relative' }}>
                    <input id="ed_cnpj" value={form.cnpj||''} onChange={e => handleCnpjChange(e.target.value)} onFocus={() => setFocusField('cnpj')} onBlur={() => setFocusField('')} onKeyDown={nxt('ed_company')} style={inp(focusField==='cnpj')} placeholder="00.000.000/0000-00" />
                    <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)' }}>
                      {cnpjStatus==='loading' && <Loader2 style={{ width:13, height:13, color:'#3B82F6' }} />}
                      {cnpjStatus==='ok' && <CheckCircle2 style={{ width:13, height:13, color:'#16A34A' }} />}
                      {cnpjStatus==='error' && <AlertCircle style={{ width:13, height:13, color:'#DC2626' }} />}
                    </div>
                  </div>
                  {cnpjStatus==='ok' && <p style={{ color:'#16A34A', fontSize:10, margin:'3px 0 0' }}>✓ Dados preenchidos</p>}
                  {cnpjStatus==='error' && rawCnpj(form.cnpj||'').length===14 && <p style={{ color:'#DC2626', fontSize:10, margin:'3px 0 0' }}>CNPJ inválido</p>}
                </div>
                ) : (
                <div>
                  <label style={lbl}>CPF</label>
                  <div style={{ position:'relative' }}>
                    <input id="ed_cpf" value={form.cpf||''} onChange={e => handleCpfChange(e.target.value)} onFocus={() => setFocusField('cpf')} onBlur={() => setFocusField('')} onKeyDown={nxt('ed_company')} style={inp(focusField==='cpf')} placeholder="000.000.000-00" />
                    <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)' }}>
                      {cpfStatus==='ok' && <CheckCircle2 style={{ width:13, height:13, color:'#16A34A' }} />}
                      {cpfStatus==='error' && <AlertCircle style={{ width:13, height:13, color:'#DC2626' }} />}
                    </div>
                  </div>
                  {cpfStatus==='error' && <p style={{ color:'#DC2626', fontSize:10, margin:'3px 0 0' }}>CPF inválido</p>}
                </div>
                )}
                <div style={{ gridColumn:'1/-1' }}>
                  <label style={lbl}>Razão Social <span style={{ color:'#4F46E5' }}>*</span></label>
                  <input id="ed_company" value={form.companyName||''} onChange={f('companyName')} onFocus={() => setFocusField('company')} onBlur={() => setFocusField('')} onKeyDown={nxt('ed_trade')} style={inp(focusField==='company')} />
                </div>
                <div style={{ gridColumn:'1/-1' }}>
                  <label style={lbl}>Nome Fantasia</label>
                  <input id="ed_trade" value={form.tradeName||''} onChange={f('tradeName')} onFocus={() => setFocusField('trade')} onBlur={() => setFocusField('')} onKeyDown={nxt('ed_ie')} style={inp(focusField==='trade')} />
                </div>
                <div>
                  <label style={lbl}>Inscrição Estadual</label>
                  <input id="ed_ie" value={form.ie||''} onChange={f('ie')} onFocus={() => setFocusField('ie')} onBlur={() => setFocusField('')} onKeyDown={nxt('ed_email')} style={inp(focusField==='ie')} />
                </div>
                <div>
                  <label style={lbl}>E-mail</label>
                  <input id="ed_email" type="email" value={form.email||''} onChange={f('email')} onFocus={() => setFocusField('email')} onBlur={() => setFocusField('')} onKeyDown={nxt('ed_phone')} style={inp(focusField==='email')} />
                </div>
                <div>
                  <label style={lbl}>Telefone</label>
                  <input id="ed_phone" value={form.phone||''} onChange={f('phone')} onFocus={() => setFocusField('phone')} onBlur={() => setFocusField('')} onKeyDown={nxt('ed_whatsapp')} style={inp(focusField==='phone')} />
                </div>
                <div>
                  <label style={lbl}>WhatsApp</label>
                  <input id="ed_whatsapp" value={form.whatsapp||''} onChange={f('whatsapp')} onFocus={() => setFocusField('whatsapp')} onBlur={() => setFocusField('')} onKeyDown={nxt('ed_website')} style={inp(focusField==='whatsapp')} />
                </div>
                <div style={{ gridColumn:'1/-1' }}>
                  <label style={lbl}>Website</label>
                  <input id="ed_website" value={form.website||''} onChange={f('website')} onFocus={() => setFocusField('website')} onBlur={() => setFocusField('')} style={inp(focusField==='website')} />
                </div>
              </div>
            </div>
          </div>

          {/* Coluna direita */}
          <div className="flex flex-col gap-4">
            {/* Endereço */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:'#F0FDF4' }}>
                  <MapPin className="w-4 h-4" style={{ color:'#16A34A' }} />
                </div>
                <h2 className="table-header">Endereço</h2>
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <label style={lbl}>CEP</label>
                  <input value={form.zipCode||''} onChange={f('zipCode')} onFocus={() => setFocusField('zip')} onBlur={() => setFocusField('')} style={inp(focusField==='zip')} />
                </div>
                <div>
                  <label style={lbl}>Logradouro</label>
                  <input value={form.address||''} onChange={f('address')} onFocus={() => setFocusField('addr')} onBlur={() => setFocusField('')} style={inp(focusField==='addr')} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 80px', gap:10 }}>
                  <div>
                    <label style={lbl}>Bairro</label>
                    <input value={form.neighborhood||''} onChange={f('neighborhood')} onFocus={() => setFocusField('neigh')} onBlur={() => setFocusField('')} style={inp(focusField==='neigh')} />
                  </div>
                  <div>
                    <label style={lbl}>Nº</label>
                    <input value={form.number||''} onChange={f('number')} onFocus={() => setFocusField('num')} onBlur={() => setFocusField('')} style={inp(focusField==='num')} />
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 80px', gap:10 }}>
                  <div>
                    <label style={lbl}>Cidade</label>
                    <input value={form.city||''} onChange={f('city')} onFocus={() => setFocusField('city')} onBlur={() => setFocusField('')} style={inp(focusField==='city')} />
                  </div>
                  <div>
                    <label style={lbl}>UF</label>
                    <select value={form.state||''} onChange={f('state')} onFocus={() => setFocusField('state')} onBlur={() => setFocusField('')}
                      style={{ ...inp(focusField==='state'), appearance:'none' as const }}>
                      <option value="">—</option>
                      {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={lbl}>Complemento</label>
                  <input value={form.complement||''} onChange={f('complement')} onFocus={() => setFocusField('comp')} onBlur={() => setFocusField('')} style={inp(focusField==='comp')} />
                </div>
              </div>
            </div>

            {/* Configurações */}
            <div className="card p-5">
              <h2 className="table-header mb-4">Configurações</h2>
              <div className="mb-4">
                <label style={lbl}>Plano de SLA</label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {PLANS.map(p => (
                    <button key={p} onClick={() => setForm((frm:any) => ({ ...frm, supportPlan:p }))}
                      style={{ padding:'6px 14px', borderRadius:8, border:`1.5px solid ${form.supportPlan===p ? PLAN_COLORS[p] : '#E2E8F0'}`, background:form.supportPlan===p ? PLAN_BG[p] : '#fff', color:form.supportPlan===p ? PLAN_COLORS[p] : '#64748B', fontSize:12, cursor:'pointer', fontWeight:form.supportPlan===p ? 700 : 400, transition:'all 0.15s' }}>
                      {PLAN_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <label style={lbl}>Status <span style={{ color:'#4F46E5' }}>*</span></label>
                <div className="flex gap-2 mt-1">
                  {[['active','Ativo','#16A34A','#F0FDF4','#BBF7D0'],['inactive','Inativo','#DC2626','#FEF2F2','#FECACA']].map(([val,label,col,bg,bdr]) => (
                    <button key={val} onClick={() => setForm((frm:any) => ({ ...frm, status:val }))}
                      style={{ padding:'7px 20px', borderRadius:8, border:`1.5px solid ${form.status===val ? bdr : '#E2E8F0'}`, background:form.status===val ? bg : '#fff', color:form.status===val ? col : '#64748B', fontSize:13, cursor:'pointer', fontWeight:form.status===val ? 700 : 400, transition:'all 0.15s' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={lbl}>Cliente desde</label>
                <input type="month" value={form.clientSince||''} onChange={f('clientSince')} onFocus={() => setFocusField('since')} onBlur={() => setFocusField('')} style={inp(focusField==='since')} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ABA CONVERSAS */}
      {activeTab === 'conversas' && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:'#ECFEFF' }}>
                <MessageCircle className="w-4 h-4" style={{ color:'#0D9488' }} />
              </div>
              <h2 className="table-header">Conversas</h2>
            </div>
          </div>
          {conversations.length === 0 && contacts.filter((c: any) => hasWhatsappChannel(c)).length === 0 ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background:'#F1F5F9' }}>
                <MessageCircle className="w-7 h-7" style={{ color:'#CBD5E1' }} />
              </div>
              <p className="font-medium mb-1" style={{ color:'#475569' }}>Nenhuma conversa</p>
              <p className="text-sm" style={{ color:'#94A3B8' }}>Cadastre um contato com WhatsApp para iniciar uma conversa</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="py-6">
              <p className="font-medium mb-3" style={{ color:'#475569' }}>Iniciar conversa WhatsApp</p>
              <div className="flex flex-col gap-2">
                {contacts.filter((c: any) => hasWhatsappChannel(c)).map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-lg" style={{ background:'#F8FAFC', border:'1px solid #E2E8F0' }}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm" style={{ background:'#CCFBF1', color:'#0F766E' }}>{c.name[0]}</div>
                      <div>
                        <p className="font-medium text-sm" style={{ color:'#0F172A' }}>{c.name}</p>
                        <p className="text-xs" style={{ color:'#64748B' }}>{getVisibleWhatsapp(c) || <span style={{ fontStyle:'italic', color:'#94A3B8' }}>Identificador técnico do WhatsApp</span>}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleStartWhatsappConversation(c.id)}
                      disabled={!!startingConv}
                      className="btn-primary"
                      style={{ padding:'6px 14px', fontSize:12, display:'flex', alignItems:'center', gap:6 }}
                    >
                      <Phone className="w-3.5 h-3.5" /> Iniciar WhatsApp
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {conversations.map((conv: any) => {
                const contact = contacts.find((c: any) => c.id === conv.contactId);
                return (
                  <div key={conv.id} className="flex items-center gap-4 p-4 rounded-xl"
                    style={{ background:'#F8FAFC', border:'1px solid #E2E8F0' }}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                      style={{ background: conv.channel === 'whatsapp' ? '#CCFBF1' : '#EEF2FF', color: conv.channel === 'whatsapp' ? '#0F766E' : '#4F46E5' }}>
                      {conv.channel === 'whatsapp' ? <Phone className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" style={{ color:'#0F172A' }}>
                          {contact?.name || 'Contato'}
                        </span>
                        <span className="text-xs" style={{ background:'#E2E8F0', color:'#64748B', padding:'2px 8px', borderRadius:4 }}>
                          {conv.channel === 'whatsapp' ? 'WhatsApp' : 'Portal'}
                        </span>
                        {!conv.ticketId && (
                          <span className="text-xs" style={{ background:'#FEF3C7', color:'#D97706', padding:'2px 8px', borderRadius:4 }}>Sem ticket</span>
                        )}
                      </div>
                      <span className="text-xs" style={{ color:'#94A3B8' }}>
                        {conv.status === 'closed' ? 'Encerrada' : 'Ativa'}
                        {' · '}{conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleString('pt-BR') : new Date(conv.createdAt).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <Link
                      href={`/dashboard/atendimento`}
                      className="btn-secondary"
                      style={{ padding:'6px 12px', display:'flex', alignItems:'center', gap:6, textDecoration:'none', fontSize:12 }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Ver
                    </Link>
                  </div>
                );
              })}
              {contacts.filter((c: any) => hasWhatsappChannel(c) && !conversations.some((conv: any) => conv.contactId === c.id && conv.channel === 'whatsapp' && conv.status === 'active')).length > 0 && (
                <div className="mt-6 pt-6" style={{ borderTop:'1px solid #E2E8F0' }}>
                  <p className="font-medium mb-3" style={{ color:'#475569' }}>Iniciar nova conversa</p>
                  {contacts.filter((c: any) => hasWhatsappChannel(c) && !conversations.some((conv: any) => conv.contactId === c.id && conv.channel === 'whatsapp' && conv.status === 'active')).map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between p-3 rounded-lg mb-2" style={{ background:'#F8FAFC', border:'1px solid #E2E8F0' }}>
                      <span className="text-sm">{c.name}{getVisibleWhatsapp(c) ? ` · ${getVisibleWhatsapp(c)}` : <span style={{ fontStyle:'italic', color:'#94A3B8' }}> · Identificador técnico do WhatsApp</span>}</span>
                      <button onClick={() => handleStartWhatsappConversation(c.id)} disabled={!!startingConv} className="btn-secondary" style={{ padding:'6px 12px', fontSize:12 }}>
                        <Phone className="w-3.5 h-3.5 inline mr-1" /> Iniciar WhatsApp
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ABA CONTATOS */}
      {activeTab === 'contatos' && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:'#F5F3FF' }}>
                <User className="w-4 h-4" style={{ color:'#7C3AED' }} />
              </div>
              <h2 className="table-header">Contatos ({contacts.length})</h2>
            </div>
            <button onClick={() => openContactModal()} className="btn-primary">
              <Plus className="w-4 h-4" /> Novo Contato
            </button>
          </div>

          {contacts.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background:'#F1F5F9' }}>
                <User className="w-7 h-7" style={{ color:'#CBD5E1' }} />
              </div>
              <p className="font-medium mb-1" style={{ color:'#475569' }}>Nenhum contato cadastrado</p>
              <p className="text-sm mb-4" style={{ color:'#94A3B8' }}>Adicione contatos para facilitar a comunicação</p>
              <button onClick={() => openContactModal()} className="btn-primary">
                <Plus className="w-4 h-4" /> Adicionar Contato
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {contacts.map((c:any) => (
                <div key={c.id} className="flex items-center gap-4 p-4 rounded-xl transition-all"
                  style={{ background: c.isPrimary ? '#EEF2FF' : '#F8FAFC', border:`1px solid ${c.isPrimary ? '#C7D2FE' : '#E2E8F0'}` }}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                    style={{ background: c.isPrimary ? 'linear-gradient(135deg,#4F46E5,#6366F1)' : '#E2E8F0', color: c.isPrimary ? '#fff' : '#64748B' }}>
                    {c.name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm" style={{ color:'#0F172A' }}>{c.name}</span>
                      {c.isPrimary && (
                        <span className="flex items-center gap-1" style={{ background:'#EEF2FF', color:'#4F46E5', padding:'1px 8px', borderRadius:20, fontSize:10, fontWeight:700, border:'1px solid #C7D2FE' }}>
                          <Star className="w-2.5 h-2.5" /> PRINCIPAL
                        </span>
                      )}
                      {c.role && <span className="text-xs" style={{ color:'#94A3B8' }}>{c.role}</span>}
                    </div>
                    <div className="flex items-center gap-4 mt-1 flex-wrap">
                      {c.email && <span className="flex items-center gap-1 text-xs" style={{ color:'#64748B' }}><Mail className="w-3 h-3" />{c.email}</span>}
                      {c.phone && <span className="flex items-center gap-1 text-xs" style={{ color:'#64748B' }}><Phone className="w-3 h-3" />{c.phone}</span>}
                      {hasWhatsappChannel(c) && (
                        <span className="flex items-center gap-1 text-xs" style={{ color:'#16A34A' }}>
                          <MessageCircle className="w-3 h-3" />
                          {getVisibleWhatsapp(c) || <span style={{ color:'#94A3B8', fontStyle:'italic' }}>Identificador técnico do WhatsApp</span>}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openContactModal(c)} className="btn-secondary" style={{ padding:'6px 8px' }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleRemoveContact(c.id)} className="btn-danger" style={{ padding:'6px 8px' }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Botões salvar */}
      {activeTab === 'dados' && (
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => router.push('/dashboard/customers')} className="btn-secondary">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ minWidth:160 }}>
            <Save className="w-4 h-4" />
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      )}

      {/* Modal Contato */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(15,23,42,0.6)', backdropFilter:'blur(4px)' }}>
          <div className="card w-full" style={{ maxWidth:520, maxHeight:'92vh', overflowY:'auto', boxShadow:'0 24px 64px rgba(0,0,0,0.2)' }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid #F1F5F9', position:'sticky', top:0, background:'#fff', zIndex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:10, background:'#EEF2FF', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <User style={{ width:16, height:16, color:'#4F46E5' }} />
                </div>
                <div>
                  <h2 style={{ color:'#0F172A', fontSize:15, fontWeight:700, margin:0 }}>{editingContact ? 'Editar Contato' : 'Novo Contato'}</h2>
                  <p style={{ color:'#94A3B8', fontSize:11, margin:0 }}>{editingContact ? 'Atualize os dados abaixo' : 'Preencha os dados do novo contato'}</p>
                </div>
              </div>
              <button onClick={() => setShowContactModal(false)}
                style={{ background:'#F1F5F9', border:'none', borderRadius:8, width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#64748B', fontSize:18 }}>×</button>
            </div>

            <div style={{ padding:'18px 20px', display:'flex', flexDirection:'column', gap:14 }}>
              {/* Identificação */}
              <div style={{ background:'#F8FAFC', borderRadius:10, padding:'14px 16px', border:'1px solid #E2E8F0' }}>
                <p style={{ fontSize:10, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.07em', margin:'0 0 12px' }}>Identificação</p>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label style={lbl}>Nome <span style={{ color:'#4F46E5' }}>*</span></label>
                    <input id="cm_name" value={contactForm.name} onChange={fc('name')} onFocus={() => setFocusCF('name')} onBlur={() => setFocusCF('')} onKeyDown={nxtC('cm_role')} style={inp(focusCF==='name')} placeholder="Nome completo" autoFocus />
                  </div>
                  <div>
                    <label style={lbl}>Cargo</label>
                    <input id="cm_role" value={contactForm.role} onChange={fc('role')} onFocus={() => setFocusCF('role')} onBlur={() => setFocusCF('')} onKeyDown={nxtC('cm_email')} style={inp(focusCF==='role')} placeholder="Ex: Gerente de TI" />
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:10, paddingTop:20, cursor:'pointer' }}
                    onClick={() => setContactForm(p => ({ ...p, isPrimary: !p.isPrimary }))}>
                    <div style={{ width:38, height:22, borderRadius:11, background:contactForm.isPrimary?'#4F46E5':'#E2E8F0', position:'relative', transition:'background 0.2s', flexShrink:0 }}>
                      <div style={{ position:'absolute', top:3, left:contactForm.isPrimary?18:3, width:16, height:16, borderRadius:'50%', background:'#fff', transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }} />
                    </div>
                    <span style={{ fontSize:13, fontWeight:500, color:contactForm.isPrimary?'#4F46E5':'#64748B', userSelect:'none' }}>Contato Principal</span>
                  </div>
                </div>
              </div>

              {/* Contato */}
              <div style={{ background:'#F8FAFC', borderRadius:10, padding:'14px 16px', border:'1px solid #E2E8F0' }}>
                <p style={{ fontSize:10, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.07em', margin:'0 0 12px' }}>Contato</p>
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <div>
                    <label style={lbl}>E-mail</label>
                    <div style={{ position:'relative' }}>
                      <input id="cm_email" value={contactForm.email} onChange={async (e) => {
                        const val = e.target.value;
                        fc('email')(e);
                        if (val.includes('@') && val.includes('.')) {
                          setEmailSearching(true);
                          try {
                            const token = localStorage.getItem('accessToken');
                            const custRes = await fetch(`/api/v1/customers/${id}`, { headers:{ Authorization:`Bearer ${token}` } });
                            const custData = await custRes.json();
                            const networkId = custData?.data?.networkId || custData?.networkId;
                            const netRes = await fetch(`/api/v1/customers?networkId=${networkId}&limit=100`, { headers:{ Authorization:`Bearer ${token}` } });
                            const netData = await netRes.json();
                            const clients = netData?.data?.data || netData?.data || [];
                            let found = null;
                            for (const cl of clients) {
                              if (cl.contacts) {
                                found = cl.contacts.find((c: any) => c.email?.toLowerCase() === val.toLowerCase() && c.status === 'active');
                                if (found) break;
                              }
                            }
                            if (found) {
                              setContactForm(p => ({ ...p, email: val, name: found.name||p.name, role: found.role||p.role, phone: found.phone||p.phone, whatsapp: getVisibleWhatsapp(found)||p.whatsapp, isPrimary: found.isPrimary||p.isPrimary, technicalWhatsapp: getTechnicalWhatsapp(found)||p.technicalWhatsapp }));
                            }
                          } catch {}
                          setEmailSearching(false);
                        }
                      }} onFocus={() => setFocusCF('email')} onBlur={() => setFocusCF('')} onKeyDown={nxtC('cm_phone')} style={inp(focusCF==='email')} placeholder="email@exemplo.com" />
                      {emailSearching && <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', width:14, height:14, border:'2px solid #6366F1', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.6s linear infinite' }} />}
                    </div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    {/* Telefone com DDI */}
                    <div>
                      <label style={lbl}>Telefone</label>
                      <div style={{ display:'flex', gap:5 }}>
                        <div style={{ position:'relative' }}>
                          <button type="button" onClick={() => { setShowPhoneCountry(p=>!p); setShowWhatsCountry(false); }}
                            style={{ height:40, padding:'0 8px', borderRadius:8, border:`1.5px solid ${focusCF==='phone'?'#6366F1':'#E2E8F0'}`, background:'#fff', cursor:'pointer', display:'flex', alignItems:'center', gap:4, fontSize:13, whiteSpace:'nowrap', minWidth:68 }}>
                            <span style={{ fontSize:15 }}>{COUNTRIES.find(c=>c.code===contactForm.phoneCountry)?.flag}</span>
                            <span style={{ color:'#374151', fontWeight:600, fontSize:12 }}>{contactForm.phoneCountry}</span>
                            <span style={{ color:'#94A3B8', fontSize:9 }}>▾</span>
                          </button>
                          {showPhoneCountry && (
                            <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:200, background:'#fff', border:'1px solid #E2E8F0', borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,.15)', width:210, maxHeight:220, overflowY:'auto' }}>
                              {COUNTRIES.map(c => (
                                <button key={c.code} type="button" onClick={() => { setContactForm(p=>({...p, phoneCountry:c.code})); setShowPhoneCountry(false); }}
                                  style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'7px 12px', background:contactForm.phoneCountry===c.code?'#EEF2FF':'transparent', border:'none', cursor:'pointer', fontSize:12, textAlign:'left' }}>
                                  <span style={{ fontSize:15 }}>{c.flag}</span>
                                  <span style={{ color:'#374151' }}>{c.name}</span>
                                  <span style={{ marginLeft:'auto', color:'#6366F1', fontWeight:700, fontSize:11 }}>{c.code}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <input id="cm_phone" value={contactForm.phone} onChange={fc('phone')} onFocus={() => { setFocusCF('phone'); setShowPhoneCountry(false); }} onBlur={() => setFocusCF('')} onKeyDown={nxtC('cm_whats')}
                          placeholder="(XX) 9 XXXX" style={{ ...inp(focusCF==='phone'), flex:1 }} />
                      </div>
                    </div>
                    {/* WhatsApp com DDI */}
                    <div>
                      <label style={lbl}>WhatsApp</label>
                      <div style={{ display:'flex', gap:5 }}>
                        <div style={{ position:'relative' }}>
                          <button type="button" onClick={() => { setShowWhatsCountry(p=>!p); setShowPhoneCountry(false); }}
                            style={{ height:40, padding:'0 8px', borderRadius:8, border:`1.5px solid ${focusCF==='whats'?'#6366F1':'#E2E8F0'}`, background:'#fff', cursor:'pointer', display:'flex', alignItems:'center', gap:4, fontSize:13, whiteSpace:'nowrap', minWidth:68 }}>
                            <span style={{ fontSize:15 }}>{COUNTRIES.find(c=>c.code===contactForm.whatsappCountry)?.flag}</span>
                            <span style={{ color:'#374151', fontWeight:600, fontSize:12 }}>{contactForm.whatsappCountry}</span>
                            <span style={{ color:'#94A3B8', fontSize:9 }}>▾</span>
                          </button>
                          {showWhatsCountry && (
                            <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:200, background:'#fff', border:'1px solid #E2E8F0', borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,.15)', width:210, maxHeight:220, overflowY:'auto' }}>
                              {COUNTRIES.map(c => (
                                <button key={c.code} type="button" onClick={() => { setContactForm(p=>({...p, whatsappCountry:c.code})); setShowWhatsCountry(false); }}
                                  style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'7px 12px', background:contactForm.whatsappCountry===c.code?'#EEF2FF':'transparent', border:'none', cursor:'pointer', fontSize:12, textAlign:'left' }}>
                                  <span style={{ fontSize:15 }}>{c.flag}</span>
                                  <span style={{ color:'#374151' }}>{c.name}</span>
                                  <span style={{ marginLeft:'auto', color:'#6366F1', fontWeight:700, fontSize:11 }}>{c.code}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <input id="cm_whats" value={contactForm.whatsapp} onChange={fc('whatsapp')} onFocus={() => { setFocusCF('whats'); setShowWhatsCountry(false); }} onBlur={() => setFocusCF('')} onKeyDown={nxtC('cm_notes')}
                          placeholder="(XX) 9 XXXX" style={{ ...inp(focusCF==='whats'), flex:1 }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Senha portal */}
              <div style={{ background:'#F0F9FF', borderRadius:10, padding:'14px 16px', border:'1px solid #BAE6FD' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <KeyRound style={{ width:14, height:14, color:'#0284C7' }} />
                    <label style={{ ...lbl, margin:0, color:'#0369A1' }}>Acesso ao Portal</label>
                  </div>
                  <button type="button" onClick={generatePassword}
                    style={{ padding:'4px 10px', borderRadius:6, border:'1.5px solid #0284C7', background:'#fff', color:'#0284C7', fontSize:11, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}>
                    <KeyRound style={{ width:11, height:11 }} /> Gerar senha
                  </button>
                </div>
                <div style={{ position:'relative' }}>
                  <input id="cm_pass" type={showContactPass?'text':'password'} value={contactForm.password} onChange={fc('password')}
                    onFocus={() => setFocusCF('pass')} onBlur={() => setFocusCF('')}
                    placeholder={editingContact ? 'Deixe em branco para manter a senha atual' : 'Senha gerada automaticamente se vazio'}
                    style={{ ...inp(focusCF==='pass'), paddingRight:44 }} />
                  <button type="button" onClick={() => setShowContactPass(p=>!p)}
                    style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94A3B8', display:'flex' }}>
                    {showContactPass ? <EyeOff style={{width:15,height:15}}/> : <Eye style={{width:15,height:15}}/>}
                  </button>
                </div>
                <p style={{ fontSize:11, color:'#0369A1', margin:'6px 0 0', opacity:0.8 }}>
                  {editingContact ? 'Login: email do contato + senha definida' : 'Novo contato recebe senha automática se não informada'}
                </p>
              </div>

              {/* Observações */}
              <div>
                <label style={lbl}>Observações</label>
                <textarea id="cm_notes" value={contactForm.notes} onChange={fc('notes')} rows={2}
                  style={{ ...inp(focusCF==='notes'), resize:'vertical' as const }} onFocus={() => setFocusCF('notes')} onBlur={() => setFocusCF('')} placeholder="Informações adicionais sobre o contato..." />
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, padding:'14px 20px', borderTop:'1px solid #F1F5F9', background:'#fff', position:'sticky', bottom:0 }}>
              <button onClick={() => setShowContactModal(false)} className="btn-secondary">Cancelar</button>
              <button onClick={handleSaveContact} disabled={savingContact || !contactForm.name.trim()} className="btn-primary"
                style={{ opacity:!contactForm.name.trim()?0.5:1 }}>
                {savingContact ? 'Salvando...' : (editingContact ? 'Salvar alterações' : 'Criar contato')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Trocar Rede */}
      {showNetworkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(15,23,42,0.6)', backdropFilter:'blur(4px)' }}>
          <div className="card w-full" style={{ maxWidth:440, maxHeight:'80vh', display:'flex', flexDirection:'column', padding:0 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid #F1F5F9' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background:'#EEF2FF' }}>
                  <Network className="w-4 h-4" style={{ color:'#4F46E5' }} />
                </div>
                <div>
                  <h2 style={{ color:'#0F172A', fontSize:15, fontWeight:700, margin:0 }}>Trocar Rede</h2>
                  <p style={{ color:'#94A3B8', fontSize:11, margin:0 }}>Selecione a nova rede para este cliente</p>
                </div>
              </div>
              <button onClick={() => setShowNetworkModal(false)}
                style={{ background:'#F1F5F9', border:'none', borderRadius:8, width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#64748B', fontSize:18 }}>×</button>
            </div>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid #F1F5F9' }}>
              <input autoFocus value={networkModalSearch} onChange={e => setNetworkModalSearch(e.target.value)}
                placeholder="Buscar rede..." style={{ ...inp(false), border:'1.5px solid #E2E8F0' }} />
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'8px 12px' }}>
              {allNetworks
                .filter(n => n.status==='active' && (!networkModalSearch || n.name.toLowerCase().includes(networkModalSearch.toLowerCase())))
                .map((n: any) => (
                  <button key={n.id} onClick={() => handleChangeNetwork(n)} disabled={changingNetwork}
                    style={{ display:'flex', alignItems:'center', gap:12, width:'100%', padding:'10px 12px', marginBottom:4, background:network?.id===n.id?'#EEF2FF':'transparent', border:`1.5px solid ${network?.id===n.id?'#4F46E5':'#E2E8F0'}`, borderRadius:10, cursor:'pointer', textAlign:'left', transition:'all 0.15s', opacity:changingNetwork?0.6:1 }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background:network?.id===n.id?'#4F46E5':'#F1F5F9' }}>
                      <Network className="w-4 h-4" style={{ color:network?.id===n.id?'#fff':'#94A3B8' }} />
                    </div>
                    <div>
                      <div style={{ fontWeight:600, fontSize:13, color:'#0F172A' }}>{n.name}</div>
                      <div style={{ fontSize:11, color:'#94A3B8' }}>#{n.code}{n.responsible?` · ${n.responsible}`:''}</div>
                    </div>
                    {network?.id===n.id && <CheckCircle2 className="w-4 h-4 ml-auto" style={{ color:'#4F46E5' }} />}
                  </button>
                ))}
            </div>
            <div style={{ padding:'12px 16px', borderTop:'1px solid #F1F5F9', display:'flex', justifyContent:'flex-end' }}>
              <button onClick={() => setShowNetworkModal(false)} className="btn-secondary">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
