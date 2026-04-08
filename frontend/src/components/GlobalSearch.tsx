'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Search, X, Ticket } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const STATUS_LABELS: Record<string, string> = {
  open: 'Aberto', in_progress: 'Em Andamento', waiting_client: 'Aguardando',
  resolved: 'Resolvido', closed: 'Fechado', cancelled: 'Cancelado',
};
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  open: { bg: '#EEF2FF', color: '#4F46E5' },
  in_progress: { bg: '#FEF3C7', color: '#D97706' },
  waiting_client: { bg: '#E0F2FE', color: '#0369A1' },
  resolved: { bg: '#DCFCE7', color: '#16A34A' },
  closed: { bg: '#F1F5F9', color: '#64748B' },
  cancelled: { bg: '#FEE2E2', color: '#DC2626' },
};

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(p => !p);
        setQuery('');
        setResults([]);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res: any = await api.getTickets({ search: q, perPage: 8 });
      const list = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
      setResults(list);
    } catch { setResults([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search]);

  const goTo = (t: any) => {
    setOpen(false);
    setQuery('');
    router.push(`/dashboard/tickets/${t.id}`);
  };

  return (
    <>
      {/* Trigger button */}
      <button onClick={() => setOpen(true)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, border: '1.5px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#64748B', cursor: 'pointer', fontSize: 12 }}
        title="Busca global (Ctrl+K)">
        <Search style={{ width: 14, height: 14 }} />
        <span style={{ color: '#475569' }}>Buscar...</span>
        <kbd style={{ marginLeft: 4, padding: '1px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', fontSize: 10, color: '#64748B', fontFamily: 'monospace' }}>Ctrl+K</kbd>
      </button>

      {/* Modal */}
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }}>
          <div ref={containerRef} style={{ width: '100%', maxWidth: 580, background: '#fff', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            {/* Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: results.length > 0 ? '1px solid #F1F5F9' : 'none' }}>
              <Search style={{ width: 18, height: 18, color: '#94A3B8', flexShrink: 0 }} />
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Buscar por número, assunto ou cliente..."
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: '#0F172A', background: 'transparent' }} />
              {loading && <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />}
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 2 }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>

            {/* Results */}
            {results.length > 0 && (
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {results.map((t: any) => {
                  const sc = STATUS_COLORS[t.status] || { bg: '#F1F5F9', color: '#64748B' };
                  return (
                    <button key={t.id} onClick={() => goTo(t)}
                      style={{ width: '100%', padding: '10px 16px', border: 'none', borderBottom: '1px solid #F8FAFC', background: '#fff', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFF')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Ticket style={{ width: 14, height: 14, color: '#4F46E5' }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#4F46E5', flexShrink: 0 }}>{t.ticketNumber}</span>
                          <span style={{ fontSize: 13, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                        </div>
                        {t.clientName && <p style={{ margin: 0, fontSize: 11, color: '#94A3B8' }}>{t.clientName}</p>}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: sc.bg, color: sc.color, flexShrink: 0 }}>
                        {STATUS_LABELS[t.status] || t.status}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {query && !loading && results.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#94A3B8' }}>
                <p style={{ margin: 0, fontSize: 13 }}>Nenhum ticket encontrado para &quot;<strong>{query}</strong>&quot;</p>
              </div>
            )}

            {!query && (
              <div style={{ padding: '16px', textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>
                Digite para buscar tickets por número, assunto ou cliente
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
