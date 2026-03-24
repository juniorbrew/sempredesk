'use client';
import { useEffect, useRef, useState } from 'react';
import { Building2, CheckCircle2, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { CandidateClient } from './CustomerSelectionModal';

// ── CNPJ helpers ──────────────────────────────────────────────────────────

function stripNonDigits(v: string): string {
  return v.replace(/\D/g, '');
}

function formatCnpj(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = stripNonDigits(raw);
  if (d.length !== 14) return raw;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

function validateCnpj(cnpj: string): boolean {
  const d = stripNonDigits(cnpj);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const calcDigit = (s: string, len: number): number => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += parseInt(s[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    return sum % 11 < 2 ? 0 : 11 - (sum % 11);
  };

  if (calcDigit(d, 12) !== parseInt(d[12])) return false;
  if (calcDigit(d, 13) !== parseInt(d[13])) return false;
  return true;
}

/** Detecta se a string parece ser um CNPJ (14 dígitos após remover formatação) */
function looksLikeCnpj(v: string): boolean {
  return stripNonDigits(v).length === 14;
}

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  ticketId: string;
  onConfirmed: (client: CandidateClient, timestamp: string) => void;
  onCancel: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * Modal de busca e vinculação de contato a uma empresa.
 * Chamado quando o contato não tem empresa candidata identificada.
 */
export default function CustomerLinkModal({ ticketId, onConfirmed, onCancel }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CandidateClient[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [cnpjError, setCnpjError] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<CandidateClient | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Foco automático no campo de busca
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  // Debounce search (300ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCnpjError(null);
    setSearchError(null);

    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    // Validação de CNPJ se parecer um CNPJ
    if (looksLikeCnpj(q)) {
      if (!validateCnpj(q)) {
        setCnpjError('CNPJ inválido. Verifique os dígitos informados.');
        setResults([]);
        setSearched(false);
        return;
      }
    }

    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      setSearched(false);
      try {
        const data: any = await api.searchCustomers(q);
        setResults(Array.isArray(data) ? data : []);
        setSearched(true);
      } catch (err: any) {
        setSearchError(err?.response?.data?.message ?? 'Erro ao buscar empresas.');
        setResults([]);
        setSearched(true);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleConfirm = async () => {
    if (!selectedClient) return;
    setConfirmLoading(true);
    setConfirmError(null);
    try {
      const res: any = await api.linkContact(ticketId, selectedClient.id);
      onConfirmed(selectedClient, res?.customerSelectedAt ?? new Date().toISOString());
    } catch (err: any) {
      setConfirmError(err?.response?.data?.message ?? 'Erro ao vincular. Tente novamente.');
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clink-title"
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
        <div style={{ padding: '22px 24px 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 id="clink-title" style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: '#111118' }}>
              Vincular a uma empresa
            </h2>
            <p style={{ margin: 0, fontSize: 12, color: '#6B6B80' }}>
              Busque pelo nome da empresa ou CNPJ
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Fechar modal"
            style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid rgba(0,0,0,.10)', background: '#F8F8FB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <X size={14} color="#6B6B80" />
          </button>
        </div>

        <div style={{ height: 1, background: 'rgba(0,0,0,.07)', flexShrink: 0 }} />

        {/* Body */}
        <div style={{ padding: '16px 24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Search input */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, border: '1px solid rgba(0,0,0,.12)',
            borderRadius: 9, padding: '9px 12px', background: '#F8F8FB',
          }}>
            {searchLoading
              ? <span style={{ width: 14, height: 14, border: '2px solid #C7D2FE', borderTopColor: '#4F46E5', borderRadius: '50%', display: 'inline-block', flexShrink: 0, animation: 'spin 0.7s linear infinite' }} />
              : <Search size={14} color="#A8A8BE" style={{ flexShrink: 0 }} />
            }
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setSelectedClient(null); setQuery(e.target.value); }}
              placeholder="Nome da empresa ou CNPJ..."
              aria-label="Buscar empresa"
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: '#111118', fontFamily: 'inherit' }}
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults([]); setSelectedClient(null); setSearched(false); }} aria-label="Limpar busca"
                style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                <X size={13} color="#A8A8BE" />
              </button>
            )}
          </div>

          {/* CNPJ validation error */}
          {cnpjError && (
            <p style={{ margin: 0, fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '7px 11px' }}>
              {cnpjError}
            </p>
          )}

          {/* Search error */}
          {searchError && (
            <p style={{ margin: 0, fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '7px 11px' }}>
              {searchError}
            </p>
          )}

          {/* Results */}
          {searched && !searchLoading && !searchError && results.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#6B6B80', fontSize: 13 }}>
              <Building2 size={28} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
              <p style={{ margin: 0 }}>Nenhuma empresa encontrada.</p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#A8A8BE' }}>
                Verifique o CNPJ ou o nome informado.
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {results.map((c) => {
                const isSelected = selectedClient?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedClient(isSelected ? null : c)}
                    aria-pressed={isSelected}
                    aria-label={`Selecionar ${c.companyName}`}
                    style={{
                      width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 9,
                      border: isSelected ? '2px solid #4F46E5' : '2px solid rgba(0,0,0,.07)',
                      background: isSelected ? '#EEF2FF' : '#F8F8FB',
                      cursor: 'pointer', transition: 'all .12s',
                      display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit',
                    }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: isSelected ? '#4F46E5' : '#E5E7EB',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Building2 size={14} color={isSelected ? '#fff' : '#6B6B80'} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111118', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.companyName}
                      </div>
                      <div style={{ fontSize: 11, color: '#6B6B80', marginTop: 2, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                        {c.cnpj && <span>{formatCnpj(c.cnpj)}</span>}
                        {c.city && <span>{c.city}{c.state ? ` – ${c.state}` : ''}</span>}
                      </div>
                    </div>
                    {isSelected && <CheckCircle2 size={16} color="#4F46E5" style={{ flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Confirmation card */}
          {selectedClient && (
            <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={18} color="#16A34A" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 600, color: '#15803D' }}>
                  Empresa selecionada
                </p>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#111118', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedClient.companyName}
                </p>
                {selectedClient.cnpj && (
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6B6B80' }}>
                    {formatCnpj(selectedClient.cnpj)}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Confirm API error */}
          {confirmError && (
            <p style={{ margin: 0, fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '7px 11px' }}>
              {confirmError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{ height: 1, background: 'rgba(0,0,0,.07)', flexShrink: 0 }} />
        <div style={{ padding: '14px 24px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={confirmLoading}
            aria-label="Cancelar"
            style={{
              padding: '8px 18px', borderRadius: 9, border: '1px solid rgba(0,0,0,.12)',
              background: '#F8F8FB', color: '#111118', fontSize: 13, fontWeight: 500,
              cursor: confirmLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedClient || confirmLoading}
            aria-label="Vincular empresa e continuar"
            style={{
              padding: '8px 20px', borderRadius: 9, border: 'none',
              background: !selectedClient || confirmLoading ? '#C7D2FE' : '#4F46E5',
              color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: !selectedClient || confirmLoading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit',
              transition: 'background .12s',
            }}
          >
            {confirmLoading && (
              <span style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
            )}
            Vincular e continuar
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
