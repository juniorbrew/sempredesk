'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

type AuditRow = {
  id: string;
  action: string;
  userId: string;
  userEmail?: string;
  userType: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
};

type ListPayload = { logs: AuditRow[]; total: number; limit: number; offset: number };

export default function AdminAuditLogsPage() {
  const [payload, setPayload] = useState<ListPayload | null>(null);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 50;

  const load = useCallback(
    async (off?: number) => {
      const useOffset = off !== undefined ? off : offset;
      setLoading(true);
      setError(null);
      try {
        const data = (await api.adminListAuditLogs({
          limit,
          offset: useOffset,
          action: action.trim() || undefined,
          entityType: entityType.trim() || undefined,
        })) as ListPayload;
        setPayload(data);
      } catch (e: any) {
        const errObj = e?.response?.data?.error;
        const msg =
          typeof errObj === 'string'
            ? errObj
            : errObj?.message || e?.message || 'Falha ao carregar auditoria';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [offset, action, entityType],
  );

  useEffect(() => {
    load();
  }, [load]);

  const aplicarFiltros = () => {
    setOffset(0);
    void load(0);
  };

  if (loading && !payload) return <div style={{ padding: 24 }}>Carregando auditoria…</div>;
  if (error) return <div style={{ padding: 24, color: 'crimson' }}>Erro: {error}</div>;

  const total = payload?.total ?? 0;
  const logs = payload?.logs ?? [];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Auditoria (master)</h1>
      <p style={{ color: '#64748b', marginBottom: 16, fontSize: 14 }}>
        Registos de acções administrativas (onboarding, licenças, suspensões).
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <a href="/admin/tenants" style={{ marginRight: 8 }}>
          ← Empresas
        </a>
        <input
          placeholder="Filtrar acção (ex. TENANT_)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          style={{ padding: 8, minWidth: 200 }}
        />
        <input
          placeholder="Tipo entidade (ex. tenant)"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          style={{ padding: 8, minWidth: 180 }}
        />
        <button type="button" onClick={aplicarFiltros} style={{ padding: '8px 12px' }}>
          Aplicar
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: 8 }}>Quando</th>
              <th style={{ padding: 8 }}>Acção</th>
              <th style={{ padding: 8 }}>Quem</th>
              <th style={{ padding: 8 }}>Entidade</th>
              <th style={{ padding: 8 }}>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((row) => (
              <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                  {row.createdAt ? new Date(row.createdAt).toLocaleString('pt-BR') : '—'}
                </td>
                <td style={{ padding: 8 }}>{row.action}</td>
                <td style={{ padding: 8 }}>
                  <div>{row.userEmail || row.userId}</div>
                  <div style={{ color: '#94a3b8', fontSize: 11 }}>{row.userType}</div>
                </td>
                <td style={{ padding: 8 }}>
                  {row.entityType}
                  <div style={{ color: '#94a3b8', fontSize: 11, wordBreak: 'break-all' }}>{row.entityId}</div>
                </td>
                <td style={{ padding: 8, maxWidth: 320, wordBreak: 'break-word' }}>
                  <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(row.details ?? {}, null, 0)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 14, color: '#64748b' }}>
          {total === 0 ? '0 registos' : `${offset + 1}–${Math.min(offset + limit, total)} de ${total}`}
        </span>
        <button
          type="button"
          disabled={offset <= 0}
          onClick={() => setOffset((o) => Math.max(0, o - limit))}
          style={{ padding: '6px 12px' }}
        >
          Anterior
        </button>
        <button
          type="button"
          disabled={offset + limit >= total}
          onClick={() => setOffset((o) => o + limit)}
          style={{ padding: '6px 12px' }}
        >
          Seguinte
        </button>
      </div>
    </div>
  );
}
