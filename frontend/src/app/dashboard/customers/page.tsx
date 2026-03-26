'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Search, Plus, Edit2, Trash2, Loader2, CheckCircle2, AlertCircle, Network, MapPin, User, X, ChevronRight, ChevronDown, ChevronLeft, MessageCircle, Building2 } from 'lucide-react';

const fmtCnpj = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
};
const rawCnpj = (v: string) => v.replace(/\D/g, '');
const fmtCpf = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};
const rawCpf = (v: string) => v.replace(/\D/g, '');
function validateCpfAlgo(cpf: string): boolean {
  const raw = cpf.replace(/\D/g, '');
  if (raw.length !== 11 || /^(\d)\1{10}$/.test(raw)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(raw[i]) * (10 - i);
  let r = 11 - (sum % 11); if (r >= 10) r = 0;
  if (r !== parseInt(raw[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(raw[i]) * (11 - i);
  r = 11 - (sum % 11); if (r >= 10) r = 0;
  return r === parseInt(raw[10]);
}
function validateCnpjAlgo(cnpj: string): boolean {
  const raw = cnpj.replace(/\D/g, '');
  if (raw.length !== 14 || /^(\d)\1{13}$/.test(raw)) return false;
  const calc = (w: number[]) => { let s = 0; for (let i = 0; i < w.length; i++) s += parseInt(raw[i]) * w[i]; const m = s % 11; return m < 2 ? 0 : 11 - m; };
  return calc([5,4,3,2,9,8,7,6,5,4,3,2]) === parseInt(raw[12]) && calc([6,5,4,3,2,9,8,7,6,5,4,3,2]) === parseInt(raw[13]);
}
const PLANS: Record<string, string> = { basic: 'Básico', standard: 'Standard', premium: 'Premium', enterprise: 'Enterprise' };
const PLAN_COLORS: Record<string, string> = { enterprise: '#a78bfa', premium: '#D97706', standard: '#3B82F6', basic: '#94A3B8' };
const STATES = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const EMPTY_FORM = { personType: 'juridica', companyName: '', tradeName: '', cnpj: '', cpf: '', email: '', phone: '', whatsapp: '', address: '', number: '', complement: '', neighborhood: '', city: '', state: '', zipCode: '', supportPlan: 'basic', status: 'active' };
const EMPTY_CONTACT = { name: '', role: '', email: '', phone: '', whatsapp: '', notes: '', isPrimary: false };

function todayFormatted() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const PER_PAGE = 30;
  const [networks, setNetworks] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [networkFilter, setNetworkFilter] = useState('');
  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false);
  const [networkDropdownSearch, setNetworkDropdownSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const networkDropdownRef = useRef<any>(null);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState<1|2|3>(1);
  const [selectedNetwork, setSelectedNetwork] = useState<any>(null);
  const [networkSearch, setNetworkSearch] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactForm, setContactForm] = useState({ ...EMPTY_CONTACT });
  const [emailSearching, setEmailSearching] = useState(false);
  const [emailFound, setEmailFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cnpjStatus, setCnpjStatus] = useState<'idle'|'loading'|'ok'|'error'>('idle');
  const [cpfStatus, setCpfStatus] = useState<'idle'|'ok'|'error'>('idle');
  const cnpjTimer = useRef<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = { limit: PER_PAGE, page };
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (networkFilter) params.networkId = networkFilter;
      const res: any = await api.getCustomers(params);
      setCustomers(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(Math.ceil((res.total || 0) / PER_PAGE));
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    api.getNetworks().then((r: any) => setNetworks(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => { setPage(1); }, [statusFilter, networkFilter]);
  useEffect(() => { load(); }, [statusFilter, networkFilter, page]);
  useEffect(() => { setPage(1); const t = setTimeout(load, 400); return () => clearTimeout(t); }, [search]);

  useEffect(() => {
    const handler = (e: any) => { if (networkDropdownRef.current && !networkDropdownRef.current.contains(e.target)) setShowNetworkDropdown(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openModal = () => {
    setStep(1); setSelectedNetwork(null); setNetworkSearch('');
    setForm({ ...EMPTY_FORM }); setContacts([]); setContactForm({ ...EMPTY_CONTACT }); setEmailFound(false);
    setError(''); setCnpjStatus('idle'); setCpfStatus('idle'); setShowModal(true);
  };

  const f = (k: string) => (e: any) => setForm(p => ({ ...p, [k]: e.target.value }));
  const fc = (k: string) => (e: any) => setContactForm(p => ({ ...p, [k]: e.target.value }));
  const next = (id?: string) => (e: any) => { if (e.key === 'Enter') { e.preventDefault(); if (id) document.getElementById(id)?.focus(); } };

  const handleCnpj = (v: string) => {
    const fmt = fmtCnpj(v);
    setForm(p => ({ ...p, cnpj: fmt }));
    clearTimeout(cnpjTimer.current);
    const raw = rawCnpj(fmt);
    if (raw.length === 14) {
      setCnpjStatus('loading');
      cnpjTimer.current = setTimeout(async () => {
        try {
          const r: any = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${raw}`).then(x => x.json());
          if (r.razao_social) {
            setForm(p => ({ ...p, companyName: r.razao_social || p.companyName, tradeName: r.nome_fantasia || p.tradeName, email: r.email || p.email, phone: r.ddd_telefone_1 || p.phone, address: r.logradouro || p.address, number: r.numero || p.number, complement: r.complemento || p.complement, neighborhood: r.bairro || p.neighborhood, city: r.municipio || p.city, state: r.uf || p.state, zipCode: r.cep?.replace(/\D/g,'').replace(/(\d{5})(\d{3})/, '$1-$2') || p.zipCode }));
            setCnpjStatus('ok');
          } else setCnpjStatus('error');
        } catch { setCnpjStatus('error'); }
      }, 600);
    } else setCnpjStatus('idle');
  };

  const handleCpf = (v: string) => {
    const fmt = fmtCpf(v);
    setForm(p => ({ ...p, cpf: fmt }));
    const raw = rawCpf(fmt);
    if (raw.length === 11) setCpfStatus(validateCpfAlgo(raw) ? 'ok' : 'error');
    else setCpfStatus('idle');
  };

  const addContact = () => {
    if (!contactForm.name.trim()) return;
    const updated = contactForm.isPrimary ? contacts.map(c => ({ ...c, isPrimary: false })) : [...contacts];
    setContacts([...updated, { ...contactForm, id: Date.now().toString() }]);
    setContactForm({ ...EMPTY_CONTACT });
    document.getElementById('fc_name')?.focus();
  };

  const handleSave = async () => {
    if (!selectedNetwork) { setError('Selecione uma rede'); setStep(1); return; }
    if (!form.companyName.trim()) { setError('Razão Social é obrigatória'); setStep(2); return; }
    if (form.personType === 'juridica' && form.cnpj && rawCnpj(form.cnpj).length === 14 && !validateCnpjAlgo(rawCnpj(form.cnpj))) {
      setError('CNPJ inválido'); setStep(2); return;
    }
    if (form.personType === 'fisica' && form.cpf && rawCpf(form.cpf).length === 11 && !validateCpfAlgo(rawCpf(form.cpf))) {
      setError('CPF inválido'); setStep(2); return;
    }
    setSaving(true); setError('');
    const payload: any = { ...form, networkId: selectedNetwork.id };
    if (form.personType === 'juridica') { payload.cnpj = rawCnpj(form.cnpj); delete payload.cpf; }
    else { payload.cpf = rawCpf(form.cpf); delete payload.cnpj; }
    try {
      const client: any = await api.createCustomer(payload);
      await Promise.all(contacts.map(c => {
        const { id, ...rest } = c;
        const clean = Object.fromEntries(Object.entries(rest).filter(([_, v]) => v !== '' && v !== null && v !== undefined));
        return api.createContact(client.id, clean);
      }));
      setShowModal(false);
      const full = Array.isArray(client) ? client[0] : client;
      if (full?.id) {
        const matchesFilter = (!networkFilter || full.networkId === networkFilter) && (statusFilter === 'all' || full.status === statusFilter);
        if (matchesFilter) {
          setCustomers((prev) => [full, ...prev].sort((a, b) => (a.code || '').localeCompare(b.code || '')));
          setTotal((t) => t + 1);
        }
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Erro ao salvar');
    }
    setSaving(false);
  };

  const handleDelete = async (c: any) => {
    if (!confirm(`Desativar "${c.companyName}"?`)) return;
    try {
      await api.deleteCustomer(c.id);
      setCustomers((prev) => prev.filter((x) => x.id !== c.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch {}
  };

  const filteredNetworks = networks.filter(n => n.status === 'active' && (!networkSearch || n.name.toLowerCase().includes(networkSearch.toLowerCase())));
  const selectedNetworkName = networkFilter ? networks.find(n => n.id === networkFilter)?.name : '';
  const mainContact = (c: any) => {
    const primary = c.contacts?.find((ct: any) => ct.isPrimary && ct.status === 'active');
    const first = c.contacts?.find((ct: any) => ct.status === 'active');
    return (primary || first)?.name || '—';
  };

  const Toggle = ({ value, onChange }: { value: boolean; onChange: () => void }) => (
    <div
      onClick={onChange}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: value ? '#EFF6FF' : '#F8FAFC', border: `1px solid ${value ? '#BFDBFE' : '#E2E8F0'}`, borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s', userSelect: 'none' as const }}
    >
      <div style={{ width: 38, height: 22, borderRadius: 11, background: value ? '#3B82F6' : '#E2E8F0', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 3, left: value ? 18 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
      </div>
      <span style={{ color: value ? '#3B82F6' : '#94A3B8', fontSize: 13, fontWeight: value ? 600 : 400 }}>Contato principal</span>
    </div>
  );

  const StepDot = ({ n, label }: { n: number; label: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: step >= n ? '#4F46E5' : '#E2E8F0', color: step >= n ? '#fff' : '#94A3B8' }}>{step > n ? '✓' : n}</div>
      <span style={{ fontSize: 13, fontWeight: step >= n ? 600 : 400 }} className={step >= n ? 't-text' : 't-text-muted'}>{label}</span>
      {n < 3 && <div style={{ width: 28, height: 1, background: '#E2E8F0', margin: '0 6px' }} />}
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg,#6366F1,#4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(99,102,241,0.35)', flexShrink: 0 }}>
            <Building2 style={{ width: 24, height: 24, color: '#fff' }} />
          </div>
          <div>
            <h1 className="page-title">Clientes</h1>
            <p className="page-subtitle">{todayFormatted()}</p>
          </div>
        </div>
        <button onClick={openModal} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Plus style={{ width: 16, height: 16 }} /> Novo Cliente
        </button>
      </div>

      {/* Filtros */}
      <div className="card" style={{ padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
          <Search style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: '#94A3B8' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente, CNPJ..."
            className="input"
            style={{ paddingLeft: 36 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {[['all','Todos'],['active','Ativos'],['inactive','Inativos']].map(([v,l]) => (
            <button key={v} onClick={() => setStatusFilter(v)}
              style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${statusFilter===v?'#3B82F6':'#E2E8F0'}`, background: statusFilter===v?'#EFF6FF':'transparent', color: statusFilter===v?'#3B82F6':'#94A3B8', fontSize: 13, cursor: 'pointer', fontWeight: statusFilter===v?600:400 }}>{l}</button>
          ))}
        </div>

        <div ref={networkDropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => { setShowNetworkDropdown(p => !p); setNetworkDropdownSearch(''); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: networkFilter ? '#EEF2FF' : 'transparent', border: `1.5px solid ${networkFilter ? '#4F46E5' : '#E2E8F0'}`, borderRadius: 8, color: networkFilter ? '#4F46E5' : '#64748B', fontSize: 13, fontWeight: networkFilter ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap' as const, transition: 'all 0.15s' }}
          >
            <Network style={{ width: 14, height: 14 }} />
            {networkFilter ? selectedNetworkName : 'Todas as redes'}
            {networkFilter ? (
              <span onClick={e => { e.stopPropagation(); setNetworkFilter(''); setShowNetworkDropdown(false); }}
                style={{ marginLeft: 4, width: 16, height: 16, borderRadius: '50%', background: '#4F46E5', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1, fontWeight: 700 }}>×</span>
            ) : (
              <ChevronDown style={{ width: 13, height: 13, marginLeft: 2, transition: 'transform 0.2s', transform: showNetworkDropdown ? 'rotate(180deg)' : 'none' }} />
            )}
          </button>

          {showNetworkDropdown && (
            <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, minWidth: 260, zIndex: 200, boxShadow: '0 10px 40px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ position: 'relative' }}>
                  <Search style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: '#94A3B8' }} />
                  <input autoFocus value={networkDropdownSearch} onChange={e => setNetworkDropdownSearch(e.target.value)} placeholder="Buscar rede..." className="input" style={{ padding: '7px 10px 7px 30px', fontSize: 12 }} />
                </div>
              </div>
              <button onClick={() => { setNetworkFilter(''); setShowNetworkDropdown(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: !networkFilter ? '#EEF2FF' : 'transparent', border: 'none', color: !networkFilter ? '#4F46E5' : '#475569', fontSize: 13, fontWeight: !networkFilter ? 600 : 400, cursor: 'pointer', textAlign: 'left' as const }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: !networkFilter ? '#4F46E5' : '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Network style={{ width: 13, height: 13, color: !networkFilter ? '#fff' : '#94A3B8' }} />
                </div>
                Todas as redes
                {!networkFilter && <CheckCircle2 style={{ width: 14, height: 14, marginLeft: 'auto', color: '#4F46E5' }} />}
              </button>
              <div style={{ borderTop: '1px solid #F1F5F9', maxHeight: 240, overflowY: 'auto' as const }}>
                {networks
                  .filter(n => n.status === 'active' && (!networkDropdownSearch || n.name.toLowerCase().includes(networkDropdownSearch.toLowerCase())))
                  .map((n: any) => (
                    <button key={n.id} onClick={() => { setNetworkFilter(n.id); setShowNetworkDropdown(false); setNetworkDropdownSearch(''); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: networkFilter===n.id ? '#EEF2FF' : 'transparent', border: 'none', color: networkFilter===n.id ? '#4F46E5' : '#475569', fontSize: 13, fontWeight: networkFilter===n.id ? 600 : 400, cursor: 'pointer', textAlign: 'left' as const }}>
                      <div style={{ width: 28, height: 28, borderRadius: 7, background: networkFilter===n.id ? '#4F46E5' : '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: networkFilter===n.id ? '#fff' : '#64748B' }}>{n.name.slice(0,2).toUpperCase()}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: networkFilter===n.id ? 700 : 500 }}>{n.name}</div>
                        <div style={{ fontSize: 11, color: '#94A3B8' }}>#{n.code}</div>
                      </div>
                      {networkFilter===n.id && <CheckCircle2 style={{ width: 14, height: 14, color: '#4F46E5', flexShrink: 0 }} />}
                    </button>
                  ))}
                {networks.filter(n => n.status === 'active' && (!networkDropdownSearch || n.name.toLowerCase().includes(networkDropdownSearch.toLowerCase()))).length === 0 && (
                  <div style={{ padding: '20px 14px', textAlign: 'center' as const, color: '#94A3B8', fontSize: 13 }}>Nenhuma rede encontrada</div>
                )}
              </div>
            </div>
          )}
        </div>

        <span style={{ marginLeft: 'auto', fontSize: 13 }} className="t-text-muted">{total} cliente{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Tabela */}
      <div className="card" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E2E8F0', background: '#FAFBFC' }}>
              {['CÓDIGO','CLIENTE','CNPJ','REDE','CONTATO PRINCIPAL','LOCALIZAÇÃO','STATUS','AÇÕES'].map(h => (
                <th key={h} className="table-header" style={{ padding: '13px 16px', textAlign: 'left', position:'sticky', top:0, background:'#FAFBFC', zIndex:1, boxShadow:'0 1px 0 #E2E8F0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 48, textAlign: 'center' }} className="t-text-muted">
                <Loader2 style={{ width: 20, height: 20, margin: '0 auto 8px', display: 'block', opacity: 0.5 }} />
                Carregando...
              </td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 48, textAlign: 'center' }} className="t-text-muted">
                {networkFilter ? `Nenhum cliente encontrado na rede "${selectedNetworkName}"` : 'Nenhum cliente encontrado'}
              </td></tr>
            ) : customers.map((c: any) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #E2E8F0', transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{ background: '#E2E8F0', color: '#3B82F6', padding: '3px 8px', borderRadius: 5, fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}>#{c.code}</span>
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ fontWeight: 600 }} className="t-text">{c.companyName}</div>
                  {c.tradeName && <div style={{ fontSize: 12 }} className="t-text-muted">{c.tradeName}</div>}
                </td>
                <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontSize: 12 }} className="t-text-muted">{c.cnpj ? fmtCnpj(c.cnpj) : '—'}</td>
                <td style={{ padding: '14px 16px' }}>
                  {c.networkId ? (
                    <span style={{ background: '#EEF2FF', color: '#4F46E5', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, border: '1px solid rgba(99,102,241,0.25)' }}>
                      {networks.find(n => n.id === c.networkId)?.name || '—'}
                    </span>
                  ) : '—'}
                </td>
                <td style={{ padding: '14px 16px', fontSize: 13 }} className="t-text-secondary">{mainContact(c)}</td>
                <td style={{ padding: '14px 16px', fontSize: 12 }} className="t-text-muted">
                  {c.city ? <span><MapPin style={{ width: 11, height: 11, display: 'inline', marginRight: 3 }} />{c.city}{c.state ? `/${c.state}` : ''}</span> : '—'}
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <span className={`badge ${c.status === 'active' ? 'badge-active' : 'badge-inactive'}`}>
                    {c.status === 'active' ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => router.push(`/dashboard/customers/${c.id}?tab=conversas`)} title="Conversas WhatsApp"
                      style={{ background: '#ECFEFF', border: 'none', borderRadius: 6, padding: 6, cursor: 'pointer', color: '#0D9488', display: 'flex' }}>
                      <MessageCircle style={{ width: 13, height: 13 }} />
                    </button>
                    <button onClick={() => router.push(`/dashboard/customers/${c.id}`)} title="Editar"
                      style={{ background: '#EEF2FF', border: 'none', borderRadius: 6, padding: 6, cursor: 'pointer', color: '#4F46E5', display: 'flex' }}>
                      <Edit2 style={{ width: 13, height: 13 }} />
                    </button>
                    <button onClick={() => handleDelete(c)}
                      style={{ background: '#FEF2F2', border: 'none', borderRadius: 6, padding: 6, cursor: 'pointer', color: '#DC2626', display: 'flex' }}>
                      <Trash2 style={{ width: 13, height: 13 }} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="card" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 20px', borderRadius:'0 0 16px 16px', marginTop: -1 }}>
          <span style={{ fontSize: 13 }} className="t-text-muted">Página {page} de {totalPages} · {total} cliente{total!==1?'s':''}</span>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={page===1} className="btn-secondary"
              style={{ padding:'6px 10px', opacity:page===1?0.4:1, display:'flex', alignItems:'center' }}>
              <ChevronLeft style={{ width:14, height:14 }} />
            </button>
            {Array.from({length:Math.min(5,totalPages)},(_,i)=>{
              let p = page <= 3 ? i+1 : page >= totalPages-2 ? totalPages-4+i : page-2+i;
              if (p < 1 || p > totalPages) return null;
              return (
                <button key={p} onClick={() => setPage(p)}
                  style={{ width:34, height:34, borderRadius:8, border:`1.5px solid ${page===p?'#6366F1':'#E2E8F0'}`, background:page===p?'#EEF2FF':'transparent', color:page===p?'#4F46E5':'#475569', fontSize:13, fontWeight:page===p?700:400, cursor:'pointer' }}>
                  {p}
                </button>
              );
            })}
            <button onClick={() => setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} className="btn-secondary"
              style={{ padding:'6px 10px', opacity:page===totalPages?0.4:1, display:'flex', alignItems:'center' }}>
              <ChevronRight style={{ width:14, height:14 }} />
            </button>
          </div>
        </div>
      )}

      {/* MODAL 3 STEPS */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: step === 1 ? 500 : 700, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', borderRadius: 16, padding: 0 }}>
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
              <div>
                <h2 style={{ fontWeight: 700, margin: 0, fontSize: 17 }} className="t-text">
                  {step === 1 ? 'Selecionar Rede' : step === 2 ? 'Dados do Cliente' : 'Contatos'}
                </h2>
                <p style={{ fontSize: 12, margin: '3px 0 0' }} className="t-text-muted">
                  {step === 1 ? 'Selecione a rede à qual o cliente pertence' : step === 2 ? `Rede: ${selectedNetwork?.name}` : 'Adicione os contatos do cliente (opcional)'}
                </p>
              </div>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 24, lineHeight: 1, padding: 4 }}>×</button>
            </div>

            {/* Step indicator */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 24px', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
              <StepDot n={1} label="Rede" /><StepDot n={2} label="Dados" /><StepDot n={3} label="Contatos" />
            </div>

            {error && (
              <div style={{ margin: '10px 24px 0', background: '#FEF2F2', color: '#DC2626', padding: '9px 14px', borderRadius: 8, fontSize: 13, flexShrink: 0, border: '1px solid #FECACA' }}>{error}</div>
            )}

            <div style={{ overflowY: 'auto', flex: 1, padding: 24 }}>
              {/* STEP 1 — Selecionar Rede */}
              {step === 1 && (
                <div>
                  <div style={{ position: 'relative', marginBottom: 14 }}>
                    <Search style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: '#94A3B8' }} />
                    <input autoFocus value={networkSearch} onChange={e => setNetworkSearch(e.target.value)} placeholder="Buscar rede..." className="input" style={{ paddingLeft: 36 }} />
                  </div>
                  {filteredNetworks.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '32px 0' }} className="t-text-muted">
                      <Network style={{ width: 32, height: 32, margin: '0 auto 12px', opacity: 0.3 }} />
                      <p style={{ margin: '0 0 12px' }}>Nenhuma rede ativa</p>
                      <button onClick={() => { setShowModal(false); router.push('/dashboard/networks'); }} className="btn-primary" style={{ fontSize: 13 }}>Criar Rede</button>
                    </div>
                  ) : filteredNetworks.map((n: any) => (
                    <button key={n.id} onClick={() => { setSelectedNetwork(n); setStep(2); setError(''); setTimeout(() => document.getElementById('f_cnpj')?.focus(), 100); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: selectedNetwork?.id===n.id?'#EFF6FF':'transparent', border: `1.5px solid ${selectedNetwork?.id===n.id?'#3B82F6':'#E2E8F0'}`, borderRadius: 10, cursor: 'pointer', width: '100%', marginBottom: 8, textAlign: 'left', transition: 'all 0.2s' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Network style={{ width: 16, height: 16, color: '#fff' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }} className="t-text">{n.name}</div>
                        <div style={{ fontSize: 12 }} className="t-text-muted">#{n.code}{n.responsible ? ` · ${n.responsible}` : ''}</div>
                      </div>
                      <ChevronRight style={{ width: 16, height: 16, color: '#94A3B8' }} />
                    </button>
                  ))}
                </div>
              )}

              {/* STEP 2 — Dados do Cliente */}
              {step === 2 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: '#EEF2FF', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 9, marginBottom: 16 }}>
                    <Network style={{ width: 14, height: 14, color: '#4F46E5' }} />
                    <span style={{ color: '#4F46E5', fontSize: 13, fontWeight: 600 }}>{selectedNetwork?.name}</span>
                    <button onClick={() => setStep(1)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '3px 10px', color: '#4F46E5', fontSize: 11, cursor: 'pointer' }}>Trocar</button>
                  </div>
                  {/* Tipo de pessoa */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    {[['juridica','Pessoa Jurídica (CNPJ)'],['fisica','Pessoa Física (CPF)']].map(([v,l]) => (
                      <button key={v} onClick={() => { setForm(p => ({ ...p, personType: v, cnpj: '', cpf: '' })); setCnpjStatus('idle'); setCpfStatus('idle'); }}
                        style={{ flex:1, padding: '8px 0', borderRadius: 8, border: `1.5px solid ${form.personType===v?'#4F46E5':'#E2E8F0'}`, background: form.personType===v?'#EEF2FF':'transparent', color: form.personType===v?'#4F46E5':'#64748B', fontSize: 13, cursor: 'pointer', fontWeight: form.personType===v?700:400, transition:'all 0.15s' }}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    {form.personType === 'juridica' ? (
                    <div style={{ gridColumn: '1/-1' }}>
                      <label className="label">CNPJ</label>
                      <div style={{ position: 'relative' }}>
                        <input id="f_cnpj" value={form.cnpj} onChange={e => handleCnpj(e.target.value)} onKeyDown={next('f_company')} placeholder="00.000.000/0000-00" className="input" />
                        <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
                          {cnpjStatus==='loading' && <Loader2 style={{ width: 14, height: 14, color: '#3B82F6' }} />}
                          {cnpjStatus==='ok' && <CheckCircle2 style={{ width: 14, height: 14, color: '#16A34A' }} />}
                          {cnpjStatus==='error' && <AlertCircle style={{ width: 14, height: 14, color: '#DC2626' }} />}
                        </div>
                      </div>
                      {cnpjStatus==='ok' && <p style={{ color: '#16A34A', fontSize: 11, margin: '4px 0 0' }}>✓ Dados preenchidos automaticamente</p>}
                      {cnpjStatus==='error' && rawCnpj(form.cnpj).length===14 && <p style={{ color: '#DC2626', fontSize: 11, margin: '4px 0 0' }}>CNPJ inválido</p>}
                    </div>
                    ) : (
                    <div style={{ gridColumn: '1/-1' }}>
                      <label className="label">CPF</label>
                      <div style={{ position: 'relative' }}>
                        <input id="f_cpf" value={form.cpf} onChange={e => handleCpf(e.target.value)} onKeyDown={next('f_company')} placeholder="000.000.000-00" className="input" />
                        <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
                          {cpfStatus==='ok' && <CheckCircle2 style={{ width: 14, height: 14, color: '#16A34A' }} />}
                          {cpfStatus==='error' && <AlertCircle style={{ width: 14, height: 14, color: '#DC2626' }} />}
                        </div>
                      </div>
                      {cpfStatus==='error' && <p style={{ color: '#DC2626', fontSize: 11, margin: '4px 0 0' }}>CPF inválido</p>}
                    </div>
                    )}
                    <div style={{ gridColumn: '1/-1' }}>
                      <label className="label">Razão Social <span style={{ color: '#6366F1' }}>*</span></label>
                      <input id="f_company" value={form.companyName} onChange={f('companyName')} onKeyDown={next('f_trade')} className="input" />
                    </div>
                    <div style={{ gridColumn: '1/-1' }}>
                      <label className="label">Nome Fantasia</label>
                      <input id="f_trade" value={form.tradeName} onChange={f('tradeName')} onKeyDown={next('f_email')} className="input" />
                    </div>
                    <div>
                      <label className="label">E-mail</label>
                      <input id="f_email" type="email" value={form.email} onChange={f('email')} onKeyDown={next('f_phone')} className="input" />
                    </div>
                    <div>
                      <label className="label">Telefone</label>
                      <input id="f_phone" value={form.phone} onChange={f('phone')} onKeyDown={next('f_address')} className="input" />
                    </div>
                    <div style={{ gridColumn: '1/-1' }}>
                      <label className="label">Logradouro</label>
                      <input id="f_address" value={form.address} onChange={f('address')} onKeyDown={next('f_number')} className="input" />
                    </div>
                    <div>
                      <label className="label">Número</label>
                      <input id="f_number" value={form.number} onChange={f('number')} onKeyDown={next('f_neighborhood')} className="input" />
                    </div>
                    <div>
                      <label className="label">Bairro</label>
                      <input id="f_neighborhood" value={form.neighborhood} onChange={f('neighborhood')} onKeyDown={next('f_city')} className="input" />
                    </div>
                    <div>
                      <label className="label">Cidade</label>
                      <input id="f_city" value={form.city} onChange={f('city')} onKeyDown={next('f_state')} className="input" />
                    </div>
                    <div>
                      <label className="label">UF</label>
                      <select id="f_state" value={form.state} onChange={f('state')} className="input" style={{ appearance: 'none' as const }}>
                        <option value="">—</option>
                        {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div style={{ gridColumn: '1/-1' }}>
                      <label className="label">Plano de SLA</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {Object.entries(PLANS).map(([k,v]) => (
                          <button key={k} onClick={() => setForm(p => ({ ...p, supportPlan: k }))}
                            style={{ padding: '7px 16px', borderRadius: 8, border: `1.5px solid ${form.supportPlan===k?PLAN_COLORS[k]:'#E2E8F0'}`, background: form.supportPlan===k?`${PLAN_COLORS[k]}1a`:'transparent', color: form.supportPlan===k?PLAN_COLORS[k]:'#94A3B8', fontSize: 13, cursor: 'pointer', fontWeight: form.supportPlan===k?600:400, transition: 'all 0.2s' }}>{v}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3 — Contatos */}
              {step === 3 && (
                <div>
                  <div className="card" style={{ padding: 18, marginBottom: 20 }}>
                    <p style={{ color: '#6366F1', fontSize: 12, fontWeight: 600, margin: '0 0 14px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>+ Adicionar Contato</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div style={{ gridColumn: '1/-1' }}>
                        <label className="label">
                          E-mail {contactForm.isPrimary && <span style={{ color: '#6366F1' }}>*</span>}
                          {emailFound && <span style={{ color:'#16A34A', fontSize:10, marginLeft:6 }}>✓ dados preenchidos</span>}
                        </label>
                        <div style={{ position:'relative' }}>
                          <input id="fc_cemail" value={contactForm.email}
                            onChange={async (e) => {
                              const val = e.target.value;
                              setContactForm(p => ({ ...p, email: val }));
                              setEmailFound(false);
                              if (val.includes('@') && val.includes('.') && selectedNetwork) {
                                setEmailSearching(true);
                                try {
                                  const token = localStorage.getItem('accessToken');
                                  const res = await fetch(`/api/v1/customers?networkId=${selectedNetwork.id}&limit=100`, { headers:{ Authorization:`Bearer ${token}` } });
                                  const data = await res.json();
                                  const clients = data?.data?.data || data?.data || [];
                                  for (const client of clients) {
                                    if (client.contacts) {
                                      const found = client.contacts.find((c: any) => c.email?.toLowerCase() === val.toLowerCase() && c.status === 'active');
                                      if (found) {
                                        setContactForm(p => ({ ...p, email: val, name: found.name||p.name, role: found.role||p.role, phone: found.phone||p.phone, whatsapp: found.whatsapp||p.whatsapp, isPrimary: found.isPrimary||p.isPrimary }));
                                        setEmailFound(true);
                                        break;
                                      }
                                    }
                                  }
                                } catch {}
                                setEmailSearching(false);
                              }
                            }}
                            onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); document.getElementById('fc_name')?.focus(); }}}
                            className="input" placeholder="email@exemplo.com" />
                          {emailSearching && (
                            <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', width:14, height:14, border:'2px solid #4F46E5', borderTopColor:'transparent', borderRadius:'50%' }} />
                          )}
                        </div>
                      </div>
                      <div style={{ gridColumn:'1/-1' }}>
                        <label className="label">Nome <span style={{ color: '#6366F1' }}>*</span></label>
                        <input id="fc_name" value={contactForm.name} onChange={fc('name')}
                          onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); document.getElementById('fc_role')?.focus(); }}}
                          placeholder="Nome do contato" className="input" />
                      </div>
                      <div style={{ gridColumn:'1/-1' }}>
                        <label className="label">Cargo</label>
                        <input id="fc_role" value={contactForm.role} onChange={fc('role')}
                          onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); document.getElementById('fc_cphone')?.focus(); }}}
                          className="input" />
                      </div>
                      <div>
                        <label className="label">Telefone</label>
                        <input id="fc_cphone" value={contactForm.phone} onChange={fc('phone')}
                          onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); document.getElementById('fc_cwhats')?.focus(); }}}
                          className="input" />
                      </div>
                      <div>
                        <label className="label">WhatsApp {contactForm.isPrimary && <span style={{ color: '#6366F1' }}>*</span>}</label>
                        <input id="fc_cwhats" value={contactForm.whatsapp} onChange={fc('whatsapp')}
                          onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); addContact(); }}}
                          className="input" />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                        <Toggle value={contactForm.isPrimary} onChange={() => setContactForm(p => ({ ...p, isPrimary: !p.isPrimary }))} />
                      </div>
                      <div style={{ gridColumn: '1/-1' }}>
                        <button onClick={addContact}
                          disabled={!contactForm.name.trim() || (contactForm.isPrimary && (!contactForm.whatsapp.trim() || !contactForm.email.trim()))}
                          className="btn-primary" style={{ width: '100%', padding: '10px 0', fontSize: 13 }}>
                          + Adicionar {contactForm.isPrimary && (!contactForm.whatsapp.trim() || !contactForm.email.trim()) ? '(preencha e-mail e WhatsApp)' : ''}
                        </button>
                      </div>
                    </div>
                    <p style={{ fontSize: 11, margin: '10px 0 0' }} className="t-text-muted">Pressione Enter no WhatsApp para adicionar rapidamente</p>
                  </div>

                  {contacts.length > 0 && (
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', margin: '0 0 10px' }} className="t-text-muted">{contacts.length} contato{contacts.length!==1?'s':''} adicionado{contacts.length!==1?'s':''}</p>
                      {contacts.map((c, i) => (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: `1px solid ${c.isPrimary?'#BFDBFE':'#E2E8F0'}`, borderRadius: 10, marginBottom: 8, background: c.isPrimary ? '#EFF6FF' : 'transparent' }}>
                          <div style={{ width: 34, height: 34, borderRadius: 8, background: c.isPrimary?'#DBEAFE':'#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <User style={{ width: 15, height: 15, color: c.isPrimary?'#3B82F6':'#94A3B8' }} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 600, fontSize: 13 }} className="t-text">{c.name}</span>
                              {c.isPrimary && <span style={{ background: '#DBEAFE', color: '#1D4ED8', padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700 }}>PRINCIPAL</span>}
                            </div>
                            <div style={{ fontSize: 12 }} className="t-text-muted">{[c.role, c.email, c.phone].filter(Boolean).join(' · ') || '—'}</div>
                          </div>
                          <button onClick={() => setContacts(p => p.filter((_, j) => j !== i))}
                            style={{ background: '#FEF2F2', border: 'none', borderRadius: 6, padding: 6, cursor: 'pointer', color: '#DC2626', display: 'flex' }}>
                            <X style={{ width: 13, height: 13 }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {contacts.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '24px 0' }} className="t-text-muted">
                      <User style={{ width: 28, height: 28, margin: '0 auto 8px', opacity: 0.3 }} />
                      <p style={{ margin: 0, fontSize: 13 }}>Nenhum contato adicionado ainda</p>
                      <p style={{ margin: '4px 0 0', fontSize: 12 }}>Você pode pular e adicionar depois</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderTop: '1px solid #E2E8F0', flexShrink: 0 }}>
              <button onClick={() => step > 1 ? setStep((step - 1) as any) : setShowModal(false)} className="btn-secondary">
                {step > 1 ? '← Voltar' : 'Cancelar'}
              </button>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {step === 3 && (
                  <button onClick={handleSave} disabled={saving} className="btn-secondary">
                    {saving ? 'Salvando...' : 'Salvar sem contatos'}
                  </button>
                )}
                {step < 3 && (
                  <button onClick={() => { if (step===2 && (!form.companyName.trim() || !form.cnpj.trim())) { setError('Preencha Razão Social e CNPJ'); return; } setError(''); setStep((step+1) as any); }}
                    className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Próximo <ChevronRight style={{ width: 14, height: 14 }} />
                  </button>
                )}
                {step === 3 && (
                  <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {saving ? <><Loader2 style={{ width: 14, height: 14 }} /> Salvando...</> : `Salvar com ${contacts.length} contato${contacts.length!==1?'s':''}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
