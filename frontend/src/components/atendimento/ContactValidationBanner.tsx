'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import CustomerSelectionModal, { type CandidateClient } from './CustomerSelectionModal';
import CustomerLinkModal from './CustomerLinkModal';

// ── Types ──────────────────────────────────────────────────────────────────

interface ContactInfo {
  id: string;
  name: string;
  whatsapp: string | null;
  email: string | null;
  phone: string | null;
}

interface ClientInfo {
  id: string;
  companyName: string;
  autoCreated: boolean;
}

interface ValidationResult {
  needsValidation: boolean;
  alreadyValidated: boolean;
  contact: ContactInfo | null;
  currentClient: ClientInfo | null;
  candidateClients: CandidateClient[];
}

type BannerState =
  | 'idle'
  | 'loading'
  | 'auto_linked'
  | 'multiple_customers'
  | 'no_customer'
  | 'resolved_selected'
  | 'resolved_linked'
  | 'resolved_skipped'
  | 'error';

export interface ResolvedData {
  clientId?: string | null;
  clientName?: string | null;
  customerSelectedAt?: string | null;
  unlinkedContact?: boolean;
}

interface Props {
  ticketId: string;
  /** Se já preenchido no ticket, pula a chamada de API */
  initialCustomerSelectedAt?: string | Date | null;
  /** Se já verdadeiro, pula a chamada de API */
  initialUnlinkedContact?: boolean;
  onResolved: (data: ResolvedData) => void;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ContactValidationBanner({
  ticketId,
  initialCustomerSelectedAt,
  initialUnlinkedContact,
  onResolved,
}: Props) {
  const [bannerState, setBannerState] = useState<BannerState>('idle');
  const [validationData, setValidationData] = useState<ValidationResult | null>(null);
  const [resolvedClient, setResolvedClient] = useState<{ id: string; name: string } | null>(null);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [skipLoading, setSkipLoading] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const didFetch = useRef(false);

  // ── Check pre-resolved state ────────────────────────────────────────────
  useEffect(() => {
    if (initialCustomerSelectedAt) {
      setBannerState('resolved_selected');
      return;
    }
    if (initialUnlinkedContact) {
      setBannerState('resolved_skipped');
      return;
    }

    if (didFetch.current) return;
    didFetch.current = true;

    // Fetch validation state from API
    setBannerState('loading');
    api.getContactValidation(ticketId)
      .then((res: any) => {
        const data = res as ValidationResult;
        setValidationData(data);

        if (data.alreadyValidated) {
          // Resolved server-side (race: another request may have resolved)
          setBannerState('resolved_selected');
          return;
        }

        if (!data.contact) {
          // No contact → nothing to show
          setBannerState('idle');
          return;
        }

        if (!data.needsValidation) {
          // Real client already identified
          setBannerState('auto_linked');
          return;
        }

        // Needs validation
        if (data.candidateClients.length > 0) {
          setBannerState('multiple_customers');
        } else {
          setBannerState('no_customer');
        }
      })
      .catch(() => {
        setBannerState('error');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  // ── Skip handler ────────────────────────────────────────────────────────
  const handleSkip = async () => {
    setSkipLoading(true);
    setSkipError(null);
    try {
      await api.skipLink(ticketId);
      setBannerState('resolved_skipped');
      setShowSkipConfirm(false);
      onResolved({ unlinkedContact: true, clientId: null, clientName: null, customerSelectedAt: null });
    } catch (err: any) {
      setSkipError(err?.response?.data?.message ?? 'Erro ao prosseguir. Tente novamente.');
    } finally {
      setSkipLoading(false);
    }
  };

  // ── Selection/Link resolution ───────────────────────────────────────────
  const handleResolved = (client: CandidateClient, timestamp: string) => {
    setResolvedClient({ id: client.id, name: client.companyName });
    setBannerState('resolved_selected');
    setShowLinkModal(false);
    onResolved({ clientId: client.id, clientName: client.companyName, customerSelectedAt: timestamp, unlinkedContact: false });
  };

  // ── Render ──────────────────────────────────────────────────────────────

  // Nothing to show
  if (bannerState === 'idle') return null;

  // Loading skeleton
  if (bannerState === 'loading') {
    return (
      <div style={{
        marginTop: 10, padding: '9px 14px', borderRadius: 8,
        background: '#F1F1F6', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#E2E8F0', flexShrink: 0 }} />
        <div style={{ width: 180, height: 10, borderRadius: 4, background: '#E2E8F0' }} />
      </div>
    );
  }

  // Error (silent — does not block UI)
  if (bannerState === 'error') return null;

  // ── Resolved: green badge ──────────────────────────────────────────────
  if (bannerState === 'resolved_selected' || bannerState === 'resolved_linked') {
    const name = resolvedClient?.name
      ?? validationData?.currentClient?.companyName
      ?? 'Empresa vinculada';
    return (
      <div style={{
        marginTop: 10, padding: '8px 14px',
        background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8,
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
      }}>
        <CheckCircle2 size={14} color="#16A34A" style={{ flexShrink: 0 }} />
        <Building2 size={13} color="#16A34A" style={{ flexShrink: 0 }} />
        <span style={{ color: '#15803D', fontWeight: 600 }}>{name}</span>
        <span style={{ color: '#6B6B80', fontWeight: 400 }}>· Cliente identificado automaticamente</span>
      </div>
    );
  }

  // ── Resolved: skipped — grey badge ────────────────────────────────────
  if (bannerState === 'resolved_skipped') {
    return (
      <div style={{
        marginTop: 10, padding: '8px 14px',
        background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8,
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6B6B80',
      }}>
        <Building2 size={13} color="#9CA3AF" style={{ flexShrink: 0 }} />
        <span style={{ fontWeight: 500 }}>Sem empresa vinculada</span>
      </div>
    );
  }

  // ── Auto-linked: green badge ───────────────────────────────────────────
  if (bannerState === 'auto_linked') {
    const name = validationData?.currentClient?.companyName ?? 'Cliente identificado';
    return (
      <div style={{
        marginTop: 10, padding: '8px 14px',
        background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8,
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
      }}>
        <CheckCircle2 size={14} color="#16A34A" style={{ flexShrink: 0 }} />
        <Building2 size={13} color="#16A34A" style={{ flexShrink: 0 }} />
        <span style={{ color: '#15803D', fontWeight: 600 }}>{name}</span>
        <span style={{ color: '#6B6B80', fontWeight: 400 }}>· Cliente identificado automaticamente</span>
      </div>
    );
  }

  // ── Multiple customers: modal ──────────────────────────────────────────
  if (bannerState === 'multiple_customers' && validationData) {
    return (
      <CustomerSelectionModal
        ticketId={ticketId}
        contact={validationData.contact}
        candidates={validationData.candidateClients}
        onConfirmed={handleResolved}
      />
    );
  }

  // ── No customer: amber banner ──────────────────────────────────────────
  if (bannerState === 'no_customer') {
    return (
      <>
        {showLinkModal && (
          <CustomerLinkModal
            ticketId={ticketId}
            onConfirmed={handleResolved}
            onCancel={() => setShowLinkModal(false)}
          />
        )}

        <div style={{
          marginTop: 10, padding: '11px 14px',
          background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8,
          fontSize: 12, color: '#92400E',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <AlertTriangle size={15} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>Contato não vinculado a nenhuma empresa</span>

              {!showSkipConfirm ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {/* Primary action */}
                  <button
                    onClick={() => setShowLinkModal(true)}
                    aria-label="Vincular contato a uma empresa"
                    style={{
                      padding: '6px 14px', borderRadius: 7, border: 'none',
                      background: '#D97706', color: '#fff', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                      fontFamily: 'inherit', transition: 'background .12s',
                    }}
                  >
                    <Building2 size={12} />
                    Vincular a uma empresa
                  </button>

                  {/* Ghost action */}
                  <button
                    onClick={() => { setShowSkipConfirm(true); setSkipError(null); }}
                    aria-label="Prosseguir sem vincular empresa"
                    style={{
                      padding: '6px 14px', borderRadius: 7,
                      border: '1px solid #FCD34D', background: 'transparent',
                      color: '#92400E', fontSize: 12, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Prosseguir sem vincular
                  </button>
                </div>
              ) : (
                /* Skip confirmation */
                <div style={{ marginTop: 8 }}>
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: '#92400E' }}>
                    Tem certeza? O ticket ficará sem empresa associada.
                  </p>
                  {skipError && (
                    <p style={{ margin: '0 0 8px', fontSize: 11, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '5px 10px' }}>
                      {skipError}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleSkip}
                      disabled={skipLoading}
                      aria-label="Confirmar: prosseguir sem vincular"
                      style={{
                        padding: '5px 14px', borderRadius: 7, border: 'none',
                        background: skipLoading ? '#FCD34D' : '#D97706',
                        color: '#fff', fontSize: 12, fontWeight: 600,
                        cursor: skipLoading ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
                      }}
                    >
                      {skipLoading && (
                        <span style={{ width: 11, height: 11, border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                      )}
                      Confirmar
                    </button>
                    <button
                      onClick={() => { setShowSkipConfirm(false); setSkipError(null); }}
                      disabled={skipLoading}
                      aria-label="Cancelar: voltar ao banner"
                      style={{
                        padding: '5px 12px', borderRadius: 7,
                        border: '1px solid #FCD34D', background: 'transparent',
                        color: '#92400E', fontSize: 12, fontWeight: 500,
                        cursor: skipLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  return null;
}
