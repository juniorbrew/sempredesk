'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

// ── Helpers de máscara ─────────────────────────────────────────────────────
function maskCnpj(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

function maskCep(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0,5)}-${d.slice(5)}`;
}

function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

function generateSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ── Estado inicial do formulário ───────────────────────────────────────────
const EMPTY_FORM = {
  // Empresa
  name: '',
  slug: '',
  cnpj: '',
  razaoSocial: '',
  nomeFantasia: '',
  email: '',
  phone: '',
  // Endereço
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  // Plano
  planSlug: 'starter',
  // Admin
  adminName: '',
  adminEmail: '',
  adminPassword: '',
};

type FormState = typeof EMPTY_FORM;

// Campos que podem ser preenchidos pelo lookup — rastreamos edições manuais
const LOOKUP_FIELDS: (keyof FormState)[] = [
  'razaoSocial', 'nomeFantasia', 'email', 'phone',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
];

export default function NewTenantPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  // Controle do lookup de CNPJ
  const [cnpjLookupStatus, setCnpjLookupStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [cnpjLookupMsg, setCnpjLookupMsg] = useState('');
  // Rastreia quais campos do lookup foram editados manualmente após o preenchimento
  const manuallyEdited = useRef<Set<keyof FormState>>(new Set());
  // Flag para ignorar a próxima mudança de CNPJ se veio de backspace/mask
  const lastLookedUpCnpj = useRef('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Geração automática de slug a partir do nome ──────────────────────────
  function handleNameChange(value: string) {
    setForm((prev) => {
      // Só auto-gera se o usuário ainda não editou o slug manualmente
      const autoSlug = !manuallyEdited.current.has('slug') && !prev.slug
        ? generateSlug(value)
        : prev.slug.length === 0 ? generateSlug(value) : prev.slug;
      return { ...prev, name: value, slug: autoSlug };
    });
  }

  // ── onChange genérico ────────────────────────────────────────────────────
  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target as { name: keyof FormState; value: string };
    manuallyEdited.current.add(name);

    if (name === 'name') { handleNameChange(value); return; }
    if (name === 'slug') {
      setForm((prev) => ({ ...prev, slug: value.toLowerCase().replace(/[^a-z0-9-]/g, '') }));
      return;
    }
    if (name === 'cnpj') {
      const masked = maskCnpj(value);
      setForm((prev) => ({ ...prev, cnpj: masked }));
      return;
    }
    if (name === 'cep') { setForm((prev) => ({ ...prev, cep: maskCep(value) })); return; }
    if (name === 'phone') { setForm((prev) => ({ ...prev, phone: maskPhone(value) })); return; }
    if (name === 'uf') { setForm((prev) => ({ ...prev, uf: value.toUpperCase().slice(0, 2) })); return; }
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  // ── Lookup de CNPJ (debounce 600ms) ─────────────────────────────────────
  useEffect(() => {
    const digits = form.cnpj.replace(/\D/g, '');
    if (digits.length !== 14) {
      if (digits.length === 0) setCnpjLookupStatus('idle');
      return;
    }
    if (digits === lastLookedUpCnpj.current) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      setCnpjLookupStatus('loading');
      setCnpjLookupMsg('');
      try {
        const data = await api.adminCnpjLookup(digits);
        lastLookedUpCnpj.current = digits;
        setCnpjLookupStatus('ok');
        setCnpjLookupMsg('Dados preenchidos automaticamente. Edite se necessário.');

        // Preenche apenas campos que o usuário não editou manualmente
        setForm((prev) => {
          const next = { ...prev };
          const fillField = (field: keyof FormState, value: string) => {
            if (!manuallyEdited.current.has(field) && value) {
              (next as any)[field] = value;
            }
          };
          fillField('razaoSocial', data.razaoSocial);
          fillField('nomeFantasia', data.nomeFantasia);
          fillField('email', data.email);
          fillField('phone', data.telefone ? maskPhone(data.telefone) : '');
          fillField('cep', data.cep ? maskCep(data.cep) : '');
          fillField('logradouro', data.logradouro);
          fillField('numero', data.numero);
          fillField('complemento', data.complemento);
          fillField('bairro', data.bairro);
          fillField('cidade', data.cidade);
          fillField('uf', data.uf);
          // Se nome da empresa ainda não preenchido, usa nomeFantasia ou razaoSocial
          if (!prev.name && (data.nomeFantasia || data.razaoSocial)) {
            const nomeSugerido = data.nomeFantasia || data.razaoSocial;
            next.name = nomeSugerido;
            if (!prev.slug) next.slug = generateSlug(nomeSugerido);
          }
          return next;
        });
      } catch (e: any) {
        setCnpjLookupStatus('error');
        const msg = e?.response?.data?.message || e?.response?.data?.error?.message || '';
        setCnpjLookupMsg(msg || 'Não foi possível buscar dados do CNPJ. Preencha manualmente.');
      }
    }, 600);
  }, [form.cnpj]);

  // ── Submit ───────────────────────────────────────────────────────────────
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Parameters<typeof api.adminCreateTenant>[0] = {
        name:         form.name,
        slug:         form.slug,
        cnpj:         form.cnpj.replace(/\D/g, '') || undefined,
        email:        form.email || undefined,
        phone:        form.phone.replace(/\D/g, '') || undefined,
        razaoSocial:  form.razaoSocial  || undefined,
        nomeFantasia: form.nomeFantasia || undefined,
        logradouro:   form.logradouro   || undefined,
        numero:       form.numero       || undefined,
        complemento:  form.complemento  || undefined,
        bairro:       form.bairro       || undefined,
        cidade:       form.cidade       || undefined,
        uf:           form.uf           || undefined,
        cep:          form.cep.replace(/\D/g, '') || undefined,
        planSlug:     form.planSlug,
        adminName:    form.adminName,
        adminEmail:   form.adminEmail,
        adminPassword: form.adminPassword || undefined,
      };
      const created = await api.adminCreateTenant(payload);
      setResult(created);
      // Limpa formulário após sucesso
      setForm(EMPTY_FORM);
      manuallyEdited.current.clear();
      lastLookedUpCnpj.current = '';
      setCnpjLookupStatus('idle');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Falha ao criar empresa');
    } finally {
      setSaving(false);
    }
  }

  // ── Estilos inline ───────────────────────────────────────────────────────
  const fieldStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 14, border: '1px solid #d1d5db', borderRadius: 6, outline: 'none', boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#374151', fontWeight: 500 };
  const sectionTitleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#111827', marginTop: 20, marginBottom: 4, borderBottom: '1px solid #e5e7eb', paddingBottom: 6 };
  const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' };
  const grid3Style: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: '10px 12px' };

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <a href="/admin/tenants" style={{ color: '#6b7280', fontSize: 13 }}>← Empresas</a>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Nova empresa</h1>
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#dc2626', fontSize: 13 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginBottom: 20, padding: '12px 16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
          <p style={{ fontWeight: 700, color: '#15803d', marginBottom: 6, fontSize: 14 }}>✓ Empresa criada com sucesso</p>
          <p style={{ fontSize: 13, color: '#166534' }}>
            Subdomínio: <strong>{result?.tenant?.slug}.sempredesk.com.br</strong>
          </p>
          <p style={{ fontSize: 13, color: '#166534' }}>
            Admin: <strong>{result?.admin?.email}</strong>
            {result?.admin?.mustChangePassword && <span style={{ marginLeft: 8, color: '#d97706' }}>(senha inicial: Mudar@123)</span>}
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* ─── CNPJ com lookup ─── */}
        <p style={sectionTitleStyle}>Identificação</p>
        <div>
          <label style={labelStyle}>
            CNPJ
            <div style={{ position: 'relative' }}>
              <input
                name="cnpj"
                value={form.cnpj}
                onChange={handleChange}
                placeholder="00.000.000/0001-00"
                style={{ ...fieldStyle, paddingRight: cnpjLookupStatus === 'loading' ? 36 : 10 }}
              />
              {cnpjLookupStatus === 'loading' && (
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#6b7280' }}>
                  ⟳
                </span>
              )}
            </div>
          </label>
          {cnpjLookupStatus === 'ok' && (
            <p style={{ fontSize: 12, color: '#16a34a', marginTop: 3 }}>✓ {cnpjLookupMsg}</p>
          )}
          {cnpjLookupStatus === 'error' && (
            <p style={{ fontSize: 12, color: '#d97706', marginTop: 3 }}>⚠ {cnpjLookupMsg}</p>
          )}
        </div>

        {/* ─── Dados da empresa ─── */}
        <p style={sectionTitleStyle}>Dados da empresa</p>
        <div style={gridStyle}>
          <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
            Nome da empresa *
            <input name="name" value={form.name} onChange={handleChange} required style={fieldStyle} placeholder="Nome exibido no sistema" />
          </label>

          <label style={labelStyle}>
            Slug / Subdomínio *
            <input name="slug" value={form.slug} onChange={handleChange} required style={fieldStyle} placeholder="empresa1" />
            <span style={{ fontSize: 11, color: '#9ca3af' }}>acesso: {form.slug || 'slug'}.sempredesk.com.br</span>
          </label>

          <label style={labelStyle}>
            E-mail corporativo
            <input name="email" type="email" value={form.email} onChange={handleChange} style={fieldStyle} placeholder="contato@empresa.com" />
          </label>

          <label style={labelStyle}>
            Telefone
            <input name="phone" value={form.phone} onChange={handleChange} style={fieldStyle} placeholder="(11) 99999-9999" />
          </label>

          <label style={labelStyle}>
            Plano
            <select name="planSlug" value={form.planSlug} onChange={handleChange} style={fieldStyle}>
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </label>
        </div>

        {/* ─── Dados Receita Federal ─── */}
        <p style={sectionTitleStyle}>Dados Receita Federal</p>
        <div style={gridStyle}>
          <label style={labelStyle}>
            Razão social
            <input name="razaoSocial" value={form.razaoSocial} onChange={handleChange} style={fieldStyle} />
          </label>
          <label style={labelStyle}>
            Nome fantasia
            <input name="nomeFantasia" value={form.nomeFantasia} onChange={handleChange} style={fieldStyle} />
          </label>
        </div>

        {/* ─── Endereço ─── */}
        <p style={sectionTitleStyle}>Endereço</p>
        <div style={grid3Style}>
          <label style={{ ...labelStyle, gridColumn: '1 / 3' }}>
            Logradouro
            <input name="logradouro" value={form.logradouro} onChange={handleChange} style={fieldStyle} placeholder="Rua, Avenida..." />
          </label>
          <label style={labelStyle}>
            Número
            <input name="numero" value={form.numero} onChange={handleChange} style={fieldStyle} />
          </label>
        </div>
        <div style={gridStyle}>
          <label style={labelStyle}>
            Complemento
            <input name="complemento" value={form.complemento} onChange={handleChange} style={fieldStyle} placeholder="Sala, Andar..." />
          </label>
          <label style={labelStyle}>
            Bairro
            <input name="bairro" value={form.bairro} onChange={handleChange} style={fieldStyle} />
          </label>
        </div>
        <div style={{ ...gridStyle, gridTemplateColumns: '1fr 100px 60px' }}>
          <label style={labelStyle}>
            Cidade
            <input name="cidade" value={form.cidade} onChange={handleChange} style={fieldStyle} />
          </label>
          <label style={labelStyle}>
            CEP
            <input name="cep" value={form.cep} onChange={handleChange} style={fieldStyle} placeholder="00000-000" />
          </label>
          <label style={labelStyle}>
            UF
            <input name="uf" value={form.uf} onChange={handleChange} style={fieldStyle} maxLength={2} placeholder="SP" />
          </label>
        </div>

        {/* ─── Admin inicial ─── */}
        <p style={sectionTitleStyle}>Administrador inicial</p>
        <div style={gridStyle}>
          <label style={labelStyle}>
            Nome *
            <input name="adminName" value={form.adminName} onChange={handleChange} required style={fieldStyle} />
          </label>
          <label style={labelStyle}>
            E-mail *
            <input name="adminEmail" type="email" value={form.adminEmail} onChange={handleChange} required style={fieldStyle} />
          </label>
          <label style={labelStyle}>
            Senha inicial
            <input name="adminPassword" type="password" value={form.adminPassword} onChange={handleChange} style={fieldStyle} placeholder="se vazio, usa Mudar@123" />
          </label>
        </div>

        <button
          type="submit"
          disabled={saving}
          style={{ marginTop: 16, padding: '10px 24px', background: saving ? '#9ca3af' : '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
        >
          {saving ? 'Criando empresa...' : 'Criar empresa'}
        </button>
      </form>
    </div>
  );
}
