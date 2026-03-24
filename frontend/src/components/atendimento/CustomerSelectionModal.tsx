'use client';
import { useEffect, useRef, useState } from 'react';
import { Building2, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CandidateClient {
  id: string;
  companyName: string;
  tradeName: string | null;
  cnpj: string | null;
  city: string | null;
  state: string | null;
}

interface Props {
  ticketId: string;
  contact: { id: string; name: string; whatsapp?: string | null; email?: string | null } | null;
  candidates: CandidateClient[];
  onConfirmed: (client: CandidateClient, timestamp: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCnpj(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length !== 14) return raw;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Modal obrigatório — sem botão de fechar/cancelar.
 * Exibido quando o ticket tem múltiplos clientes candidatos para o contato.
 * O agente deve selecionar um antes de prosseguir.
 */
export default function CustomerSelectionModal({ ticketId, contact, candidates, onConfirmed }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);

  // Foco automático ao abrir
  useEffect(() => {
    const t = setTimeout(() => firstBtnRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  const handleConfirm = async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const res: any = await api.selectCustomer(ticketId, selectedId);
      const chosen = candidates.find((c) => c.id === selectedId)!;
      onConfirmed(chosen, res?.customerSelectedAt ?? new Date().toISOString());
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erro ao confirmar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    /* Overlay — pointer-events none nas bordas, mas não tem onClick para fechar */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="csel-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480,
        boxShadow: '0 20px 60px rgba(0,0,0,.18)',
        display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 80px)',
      }}>

        {/* Header */}
        <div style={{ padding: '22px 24px 16px' }}>
          <h2 id="csel-title" style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#111118' }}>
            Para qual empresa é este atendimento?
          </h2>
          {contact && (
            <p style={{ margin: 0, fontSize: 12, color: '#6B6B80' }}>
              Contato: <strong style={{ color: '#111118' }}>{contact.name}</strong>
              {contact.whatsapp && (
                <span style={{ marginLeft: 6, color: '#6B6B80' }}>· {contact.whatsapp}</span>
              )}
              {contact.email && (
                <span style={{ marginLeft: 6, color: '#6B6B80' }}>· {contact.email}</span>
              )}
            </p>
          )}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(0,0,0,.07)', flexShrink: 0 }} />

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {candidates.map((c, i) => {
            const isSelected = selectedId === c.id;
            return (
              <button
                key={c.id}
                ref={i === 0 ? firstBtnRef : undefined}
                onClick={() => setSelectedId(c.id)}
                aria-pressed={isSelected}
                aria-label={`Selecionar ${c.companyName}`}
                style={{
                  width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 10,
                  border: isSelected ? '2px solid #4F46E5' : '2px solid rgba(0,0,0,.07)',
                  background: isSelected ? '#EEF2FF' : '#fff',
                  cursor: 'pointer', transition: 'all .12s',
                  display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'inherit',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                  background: isSelected ? '#4F46E5' : '#F1F1F6',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Building2 size={16} color={isSelected ? '#fff' : '#6B6B80'} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111118', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.companyName}
                  </div>
                  <div style={{ fontSize: 11, color: '#6B6B80', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {c.cnpj && <span>{formatCnpj(c.cnpj)}</span>}
                    {c.city && <span>{c.city}{c.state ? ` – ${c.state}` : ''}</span>}
                  </div>
                </div>
                {isSelected && (
                  <CheckCircle2 size={18} color="#4F46E5" style={{ flexShrink: 0 }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: '0 24px 12px' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px' }}>
              {error}
            </p>
          </div>
        )}

        {/* Footer */}
        <div style={{ height: 1, background: 'rgba(0,0,0,.07)', flexShrink: 0 }} />
        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleConfirm}
            disabled={!selectedId || loading}
            aria-label="Confirmar empresa selecionada"
            style={{
              padding: '9px 22px', borderRadius: 9, border: 'none',
              background: !selectedId || loading ? '#C7D2FE' : '#4F46E5',
              color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: !selectedId || loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit',
              transition: 'background .12s',
            }}
          >
            {loading && (
              <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
            )}
            Confirmar
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
