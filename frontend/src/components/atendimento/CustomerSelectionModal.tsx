'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Building2, CheckCircle2, Search, X } from 'lucide-react';
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
  onCancel: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCnpj(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length !== 14) return raw;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12,14)}`;
}

function formatWhatsApp(raw?: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0,2)}) ${local[2]} ${local.slice(3,7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0,2)}) ${local.slice(2,6)}-${local.slice(6)}`;
  return digits;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function CustomerSelectionModal({ ticketId, contact, candidates, onConfirmed, onCancel }: Props) {
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<CandidateClient | null>(null);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState<CandidateClient[]>([]);
  const [searching, setSearching]         = useState(false);
  const [showSearch, setShowSearch]       = useState(false);

  const searchRef  = useRef<HTMLInputElement>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => firstBtnRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (showSearch) setTimeout(() => searchRef.current?.focus(), 60);
  }, [showSearch]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res: any = await api.getCustomers({ search: q.trim(), perPage: 30 });
      const list: any[] = res?.data ?? res ?? [];
      setSearchResults(list.map((c: any) => ({
        id: c.id,
        companyName: c.tradeName || c.companyName || c.name,
        tradeName: c.tradeName ?? null,
        cnpj: c.cnpj ?? null,
        city: c.city ?? null,
        state: c.state ?? null,
      })));
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, []);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(val), 350);
  };

  const handleSelect = (c: CandidateClient) => {
    setSelectedId(c.id);
    setSelectedClient(c);
  };

  const handleConfirm = async () => {
    if (!selectedId || !selectedClient) return;
    setLoading(true); setError(null);
    try {
      const res: any = await api.selectCustomer(ticketId, selectedId);
      onConfirmed(selectedClient, res?.customerSelectedAt ?? new Date().toISOString());
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erro ao confirmar. Tente novamente.');
    } finally { setLoading(false); }
  };

  const ClientCard = ({ c, isFirst }: { c: CandidateClient; isFirst?: boolean }) => {
    const isSel = selectedId === c.id;
    return (
      <button
        ref={isFirst && !showSearch ? firstBtnRef : undefined}
        onClick={() => handleSelect(c)}
        aria-pressed={isSel}
        style={{
          width: '100%', textAlign: 'left', padding: '11px 14px', borderRadius: 10,
          border: isSel ? '2px solid #4F46E5' : '2px solid rgba(0,0,0,.07)',
          background: isSel ? '#EEF2FF' : '#fff',
          cursor: 'pointer', transition: 'all .12s',
          display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'inherit',
        }}
      >
        <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: isSel ? '#4F46E5' : '#F1F1F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Building2 size={15} color={isSel ? '#fff' : '#6B6B80'} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111118', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.companyName}</div>
          <div style={{ fontSize: 11, color: '#6B6B80', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {c.cnpj && <span>{formatCnpj(c.cnpj)}</span>}
            {c.city && <span>{c.city}{c.state ? ` – ${c.state}` : ''}</span>}
          </div>
        </div>
        {isSel && <CheckCircle2 size={18} color="#4F46E5" style={{ flexShrink: 0 }} />}
      </button>
    );
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="csel-title"
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 80px)' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 14px' }}>
          <h2 id="csel-title" style={{ margin: '0 0 5px', fontSize: 16, fontWeight: 700, color: '#111118' }}>Para qual empresa é este atendimento?</h2>
          {contact && (
            <p style={{ margin: 0, fontSize: 12, color: '#6B6B80' }}>
              Contato: <strong style={{ color: '#111118' }}>{contact.name}</strong>
              {contact.whatsapp && <span style={{ marginLeft: 6 }}>· {formatWhatsApp(contact.whatsapp)}</span>}
              {contact.email && <span style={{ marginLeft: 6 }}>· {contact.email}</span>}
            </p>
          )}
        </div>

        <div style={{ height: 1, background: 'rgba(0,0,0,.07)', flexShrink: 0 }} />

        {/* Abas: Sugeridas / Buscar */}
        <div style={{ padding: '10px 16px 6px', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
            style={{ padding: '5px 14px', borderRadius: 20, border: 'none', fontFamily: 'inherit', background: !showSearch ? '#EEF2FF' : 'transparent', color: !showSearch ? '#4F46E5' : '#6B6B80', fontWeight: !showSearch ? 600 : 500, fontSize: 12, cursor: 'pointer' }}>
            {candidates.length === 1 ? '1 sugerida' : `${candidates.length} sugeridas`}
          </button>
          <button onClick={() => setShowSearch(true)}
            style={{ padding: '5px 14px', borderRadius: 20, border: 'none', fontFamily: 'inherit', background: showSearch ? '#EEF2FF' : 'transparent', color: showSearch ? '#4F46E5' : '#6B6B80', fontWeight: showSearch ? 600 : 500, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Search size={11} /> Buscar outra empresa
          </button>
        </div>

        {/* Campo de busca */}
        {showSearch && (
          <div style={{ padding: '0 16px 8px', position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 28, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }} />
            <input ref={searchRef} value={searchQuery} onChange={e => handleSearchChange(e.target.value)}
              placeholder="Nome fantasia, razão social ou CNPJ..."
              style={{ width: '100%', padding: '9px 34px 9px 34px', borderRadius: 9, border: '1.5px solid #E2E8F0', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                style={{ position: 'absolute', right: 28, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 2 }}>
                <X size={13} />
              </button>
            )}
          </div>
        )}

        {/* Lista */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '4px 16px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {showSearch ? (
            searching ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#94A3B8', fontSize: 13 }}>Buscando...</div>
            ) : !searchQuery ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#94A3B8', fontSize: 13 }}>Digite para buscar entre todos os clientes cadastrados</div>
            ) : searchResults.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#94A3B8', fontSize: 13 }}>Nenhuma empresa encontrada</div>
            ) : (
              searchResults.map((c, i) => <ClientCard key={c.id} c={c} isFirst={i === 0} />)
            )
          ) : (
            candidates.map((c, i) => <ClientCard key={c.id} c={c} isFirst={i === 0} />)
          )}
        </div>

        {/* Preview do selecionado quando veio da busca */}
        {selectedClient && showSearch && (
          <>
            <div style={{ height: 1, background: 'rgba(0,0,0,.07)', flexShrink: 0 }} />
            <div style={{ padding: '9px 20px', background: '#F8F9FF', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={13} color="#4F46E5" />
              <span style={{ fontSize: 12, color: '#4F46E5', fontWeight: 600 }}>Selecionado:</span>
              <span style={{ fontSize: 12, color: '#111118', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedClient.companyName}</span>
            </div>
          </>
        )}

        {/* Erro */}
        {error && (
          <div style={{ padding: '0 24px 10px' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px' }}>{error}</p>
          </div>
        )}

        <div style={{ height: 1, background: 'rgba(0,0,0,.07)', flexShrink: 0 }} />

        {/* Footer */}
        <div style={{ padding: '14px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onCancel} disabled={loading}
            style={{ padding: '9px 18px', borderRadius: 9, border: '1px solid rgba(0,0,0,.12)', background: '#F8F8FB', color: '#111118', fontSize: 13, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            Cancelar
          </button>
          <button onClick={handleConfirm} disabled={!selectedId || loading}
            style={{ padding: '9px 24px', borderRadius: 9, border: 'none', background: !selectedId || loading ? '#C7D2FE' : '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 600, cursor: !selectedId || loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit', transition: 'background .12s' }}>
            {loading && <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />}
            Confirmar
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
