'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan?: string;
};

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.adminListTenants()
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
  }, []);

  if (loading) return <div style={{ padding: 24 }}>Carregando empresas...</div>;
  if (error) return <div style={{ padding: 24, color: 'red' }}>Erro: {error}</div>;

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Empresas (Tenants)</h1>

      <a href="/admin/tenants/new" style={{ display: 'inline-block', marginBottom: 16 }}>
        + Nova empresa
      </a>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Nome</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Slug</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Status</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Plano</th>
            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id}>
              <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{t.name}</td>
              <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{t.slug}</td>
              <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{t.status}</td>
              <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{t.plan || '-'}</td>
              <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                <a href={`/admin/tenants/${t.id}`}>Ver / Editar</a>
              </td>
            </tr>
          ))}
          {tenants.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#666' }}>
                Nenhuma empresa cadastrada.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

