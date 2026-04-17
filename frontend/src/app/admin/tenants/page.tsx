'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const SUBDOMAIN_BASE = 'sempredesk.com.br';

type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  cnpj?: string;
  email?: string;
  status: string;
  plan?: string;
  license?: {
    status: string;
    expiresAt?: string;
  } | null;
};

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    let mounted = true;
    setLoading(true);
    api.adminListTenants({ search: search || undefined, status: statusFilter || undefined })
      .then((data: any) => {
        if (!mounted) return;
        setTenants(data || []);
        setError(null);
      })
      .catch((err: any) => {
        if (!mounted) return;
        setError(err?.response?.data?.message || 'Falha ao carregar empresas');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  };

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, []);

  const suspend = async (id: string) => {
    await api.adminSuspendTenant(id);
    load();
  };

  const reactivate = async (id: string) => {
    await api.adminReactivateTenant(id);
    load();
  };

  const renew = async (id: string) => {
    const daysInput = window.prompt('Renovar por quantos dias?', '30');
    const days = Number(daysInput || 30);
    await api.adminRenewLicense(id, Number.isFinite(days) && days > 0 ? days : 30);
    load();
  };

  if (loading) return <div style={{ padding: 24 }}>Carregando empresas...</div>;
  if (error) return <div style={{ padding: 24, color: 'red' }}>Erro: {error}</div>;

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Empresas (Tenants)</h1>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <a href="/admin/tenants/new">+ Nova empresa</a>
        <a href="/admin/audit-logs">Auditoria</a>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Buscar por nome, CNPJ ou e-mail"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: 8 }}>
          <option value="">Todos status</option>
          <option value="trial">trial</option>
          <option value="active">active</option>
          <option value="suspended">suspended</option>
        </select>
        <button onClick={() => load()} style={{ padding: '8px 12px' }}>Buscar</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Nome</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>CNPJ/E-mail</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Subdomínio</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Status</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Licença</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => {
            const subdomain = `${t.slug}.${SUBDOMAIN_BASE}`;
            const fullUrl = `https://${subdomain}`;
            return (
              <tr key={t.id}>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{t.name}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                  {t.cnpj || '-'}
                  <div style={{ fontSize: 12, color: '#666' }}>{t.email || '-'}</div>
                </td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <a
                      href={fullUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13, color: '#4f46e5', textDecoration: 'none', fontFamily: 'monospace' }}
                      title={`Abrir ${fullUrl}`}
                    >
                      {subdomain}
                    </a>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(fullUrl);
                        alert(`Copiado: ${fullUrl}`);
                      }}
                      style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 11, color: '#6b7280' }}
                      title="Copiar URL"
                    >
                      copiar
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>slug: {t.slug}</div>
                </td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{t.status}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                  {t.license?.status || '-'}
                  <div style={{ fontSize: 12, color: '#666' }}>
                    vence: {t.license?.expiresAt ? new Date(t.license.expiresAt).toLocaleDateString() : '-'}
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>plano: {t.plan || '-'}</div>
                </td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee', display: 'flex', gap: 8 }}>
                  <button onClick={() => renew(t.id)}>Renovar</button>
                  {t.status === 'suspended' ? (
                    <button onClick={() => reactivate(t.id)}>Reativar</button>
                  ) : (
                    <button onClick={() => suspend(t.id)}>Suspender</button>
                  )}
                </td>
              </tr>
            );
          })}
          {tenants.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: 16, textAlign: 'center', color: '#666' }}>
                Nenhuma empresa cadastrada.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

