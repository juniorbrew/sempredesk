'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

export default function NewTenantPage() {
  const [form, setForm] = useState({
    name: '',
    slug: '',
    cnpj: '',
    email: '',
    phone: '',
    planSlug: 'starter',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        slug: form.slug,
        cnpj: form.cnpj || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        planSlug: form.planSlug,
        adminName: form.adminName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword || undefined,
      };
      const created = await api.adminCreateTenant(payload);
      setResult(created);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Falha ao criar empresa');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Nova empresa</h1>

      {error && (
        <div style={{ marginBottom: 12, color: 'red' }}>
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 18 }}>Dados da empresa</h2>

        <label>
          Nome
          <input
            name="name"
            value={form.name}
            onChange={onChange}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </label>

        <label>
          Slug
          <input
            name="slug"
            value={form.slug}
            onChange={onChange}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </label>

        <label>
          CNPJ
          <input
            name="cnpj"
            value={form.cnpj}
            onChange={onChange}
            style={{ width: '100%', padding: 8 }}
          />
        </label>

        <label>
          E-mail
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={onChange}
            style={{ width: '100%', padding: 8 }}
          />
        </label>

        <label>
          Telefone
          <input
            name="phone"
            value={form.phone}
            onChange={onChange}
            style={{ width: '100%', padding: 8 }}
          />
        </label>

        <label>
          Plano
          <select
            name="planSlug"
            value={form.planSlug}
            onChange={onChange}
            style={{ width: '100%', padding: 8 }}
          >
            <option value="starter">Starter</option>
            <option value="professional">Professional</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>

        <h2 style={{ fontSize: 18, marginTop: 16 }}>Admin da empresa</h2>

        <label>
          Nome do admin
          <input
            name="adminName"
            value={form.adminName}
            onChange={onChange}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </label>

        <label>
          E-mail do admin
          <input
            name="adminEmail"
            type="email"
            value={form.adminEmail}
            onChange={onChange}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </label>

        <label>
          Senha inicial (opcional)
          <input
            name="adminPassword"
            type="password"
            value={form.adminPassword}
            onChange={onChange}
            style={{ width: '100%', padding: 8 }}
            placeholder="se vazio, usa Mudar@123"
          />
        </label>

        <button type="submit" disabled={saving} style={{ padding: 8, marginTop: 8 }}>
          {saving ? 'Criando...' : 'Criar empresa'}
        </button>
      </form>

      {result && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>Empresa criada</h2>
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', background: '#111', color: '#eee', padding: 12 }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

