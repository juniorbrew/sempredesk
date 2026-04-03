'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import CustomerSelectionModal, { type CandidateClient } from './CustomerSelectionModal';
import CustomerLinkModal from './CustomerLinkModal';

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
  initialCustomerSelectedAt?: string | Date | null;
  initialUnlinkedContact?: boolean;
  initialCustomerName?: string | null;
  canManageCustomerLink?: boolean;
  onResolved: (data: ResolvedData) => void;
  onRequirementChange?: (required: boolean) => void;
}

export default function ContactValidationBanner({
  ticketId,
  initialCustomerSelectedAt,
  initialUnlinkedContact,
  initialCustomerName,
  canManageCustomerLink = false,
  onResolved,
  onRequirementChange,
}: Props) {
  const [bannerState, setBannerState] = useState<BannerState>('idle');
  const [validationData, setValidationData] = useState<ValidationResult | null>(null);
  const [resolvedClient, setResolvedClient] = useState<{ id: string; name: string } | null>(null);
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const didFetch = useRef(false);

  useEffect(() => {
    if (initialCustomerSelectedAt) {
      setBannerState('resolved_selected');
      onRequirementChange?.(false);
      return;
    }
    if (initialUnlinkedContact) {
      setBannerState('resolved_skipped');
      onRequirementChange?.(true);
      return;
    }

    if (didFetch.current) return;
    didFetch.current = true;

    setBannerState('loading');
    api.getContactValidation(ticketId)
      .then((res: any) => {
        const data = res as ValidationResult;
        setValidationData(data);

        if (data.alreadyValidated) {
          setBannerState('resolved_selected');
          onRequirementChange?.(false);
          return;
        }

        if (!data.contact) {
          setBannerState('idle');
          onRequirementChange?.(false);
          return;
        }

        if (!data.needsValidation) {
          setBannerState('auto_linked');
          onRequirementChange?.(false);
          return;
        }

        onRequirementChange?.(true);
        setBannerState(data.candidateClients.length > 0 ? 'multiple_customers' : 'no_customer');
      })
      .catch(() => {
        setBannerState('error');
        onRequirementChange?.(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const handleResolved = (client: CandidateClient, timestamp: string) => {
    setResolvedClient({ id: client.id, name: client.companyName });
    setBannerState('resolved_selected');
    setShowSelectionModal(false);
    setShowLinkModal(false);
    onRequirementChange?.(false);
    onResolved({
      clientId: client.id,
      clientName: client.companyName,
      customerSelectedAt: timestamp,
      unlinkedContact: false,
    });
  };

  if (showSelectionModal && validationData) {
    return (
      <CustomerSelectionModal
        ticketId={ticketId}
        contact={validationData.contact}
        candidates={validationData.candidateClients}
        onConfirmed={handleResolved}
        onCancel={() => setShowSelectionModal(false)}
      />
    );
  }

  if (showLinkModal) {
    return (
      <CustomerLinkModal
        ticketId={ticketId}
        onConfirmed={handleResolved}
        onCancel={() => setShowLinkModal(false)}
      />
    );
  }

  if (bannerState === 'idle' || bannerState === 'error') return null;

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

  if (bannerState === 'resolved_selected' || bannerState === 'auto_linked') {
    const name = resolvedClient?.name
      ?? validationData?.currentClient?.companyName
      ?? initialCustomerName
      ?? 'Empresa vinculada';
    return (
      <div style={{
        marginTop: 12, padding: '10px 14px',
        background: 'linear-gradient(135deg, #F0FDF4, #ECFDF5)', border: '1px solid #86EFAC', borderRadius: 14,
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
        boxShadow: '0 10px 24px rgba(22,163,74,.08)',
      }}>
        <CheckCircle2 size={14} color="#16A34A" style={{ flexShrink: 0 }} />
        <Building2 size={13} color="#16A34A" style={{ flexShrink: 0 }} />
        <span style={{ color: '#15803D', fontWeight: 600 }}>{name}</span>
        <span style={{ color: '#6B6B80', fontWeight: 400 }}>· Empresa definida para este atendimento</span>
        {canManageCustomerLink && (
          <button
            onClick={() => setShowLinkModal(true)}
            style={{ marginLeft: 'auto', padding: '6px 11px', borderRadius: 999, border: '1px solid #86EFAC', background: '#fff', color: '#166534', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Alterar empresa
          </button>
        )}
      </div>
    );
  }

  if (bannerState === 'resolved_skipped') {
    return (
      <div style={{
        marginTop: 12, padding: '11px 14px',
        background: 'linear-gradient(135deg, #FFF7ED, #FFFBEB)', border: '1px solid #FED7AA', borderRadius: 14,
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9A3412',
        boxShadow: '0 10px 24px rgba(234,88,12,.08)',
      }}>
        <Building2 size={13} color="#EA580C" style={{ flexShrink: 0 }} />
        <span style={{ fontWeight: 600 }}>Empresa ainda não vinculada a este atendimento</span>
        {canManageCustomerLink && (
          <button
            onClick={() => setShowLinkModal(true)}
            style={{ marginLeft: 'auto', padding: '6px 11px', borderRadius: 999, border: '1px solid #FDBA74', background: '#fff', color: '#C2410C', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Vincular agora
          </button>
        )}
      </div>
    );
  }

  if (bannerState === 'multiple_customers') {
    return (
      <div style={{
        marginTop: 12, padding: '13px 15px',
        background: 'linear-gradient(135deg, #FFFBEB, #FFF7ED)', border: '1px solid #FDE68A', borderRadius: 16,
        fontSize: 12, color: '#92400E',
        boxShadow: '0 12px 26px rgba(217,119,6,.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={15} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600 }}>Este contato pode estar vinculado a mais de uma empresa</span>
            <p style={{ margin: '6px 0 0', color: '#A16207' }}>
              Você pode continuar a conversa normalmente e definir a empresa correta quando precisar.
            </p>
            {canManageCustomerLink && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => setShowSelectionModal(true)}
                  style={{ padding: '7px 14px', borderRadius: 999, border: 'none', background: '#D97706', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', boxShadow: '0 10px 18px rgba(217,119,6,.18)' }}
                >
                  <Building2 size={12} />
                  Selecionar empresa
                </button>
                <button
                  onClick={() => setShowLinkModal(true)}
                  style={{ padding: '7px 14px', borderRadius: 999, border: '1px solid #FCD34D', background: 'rgba(255,255,255,.78)', color: '#92400E', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Buscar outra empresa
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (bannerState === 'no_customer') {
    return (
      <div style={{
        marginTop: 12, padding: '13px 15px',
        background: 'linear-gradient(135deg, #FFFBEB, #FFF7ED)', border: '1px solid #FDE68A', borderRadius: 16,
        fontSize: 12, color: '#92400E',
        boxShadow: '0 12px 26px rgba(217,119,6,.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={15} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600 }}>Contato não vinculado a nenhuma empresa</span>
            <p style={{ margin: '6px 0 0', color: '#A16207' }}>
              Você pode continuar a conversa e vincular a empresa depois. O encerramento só será liberado após essa definição.
            </p>
            {canManageCustomerLink && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => setShowLinkModal(true)}
                  aria-label="Vincular contato a uma empresa"
                  style={{ padding: '7px 14px', borderRadius: 999, border: 'none', background: '#D97706', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', boxShadow: '0 10px 18px rgba(217,119,6,.18)' }}
                >
                  <Building2 size={12} />
                  Vincular a uma empresa
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
