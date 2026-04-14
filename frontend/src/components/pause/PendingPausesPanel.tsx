'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useRealtimePauseRequested, useRealtimePauseEvents } from '@/lib/realtime';
import { Coffee, Clock, Check, X, ChevronDown, ChevronUp, Bell } from 'lucide-react';

export interface PauseRequestItem {
  id: string;
  agentId: string;
  agentName: string;
  reasonName: string;
  agentObservation?: string;
  requestedAt: string;
  status: string;
}

interface ReviewModalState {
  request: PauseRequestItem;
  action: 'approve' | 'reject';
}

const S = {
  panel: {
    background: 'var(--bg, #fff)',
    border: '1px solid rgba(0,0,0,.08)',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 16,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    cursor: 'pointer',
    userSelect: 'none' as const,
    borderBottom: '1px solid rgba(0,0,0,.06)',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 15,
    fontWeight: 700,
  },
  badge: (n: number): React.CSSProperties => ({
    background: n > 0 ? '#DC2626' : '#9CA3AF',
    color: '#fff',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 7px',
    minWidth: 20,
    textAlign: 'center',
  }),
  empty: {
    padding: '20px 18px',
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center' as const,
  },
  item: {
    padding: '14px 18px',
    borderBottom: '1px solid rgba(0,0,0,.05)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  itemRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  agentName: { fontSize: 14, fontWeight: 600 },
  reasonBadge: {
    fontSize: 12,
    fontWeight: 500,
    background: '#EEF2FF',
    color: '#4F46E5',
    borderRadius: 6,
    padding: '2px 8px',
  },
  time: { fontSize: 12, color: '#9CA3AF' },
  obs: { fontSize: 12, color: '#6B7280', fontStyle: 'italic' as const, padding: '6px 10px', background: '#F9FAFB', borderRadius: 8 },
  actions: { display: 'flex', gap: 8, marginTop: 2 },
  btnApprove: {
    flex: 1,
    padding: '8px 0',
    borderRadius: 8,
    border: 'none',
    background: '#16A34A',
    color: '#fff',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  btnReject: {
    flex: 1,
    padding: '8px 0',
    borderRadius: 8,
    border: '1px solid rgba(0,0,0,.12)',
    background: 'transparent',
    color: '#DC2626',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  // Modal
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    zIndex: 1100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modal: {
    background: 'var(--bg, #fff)',
    borderRadius: 14,
    width: '100%',
    maxWidth: 420,
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    overflow: 'hidden',
  },
  mHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 20px 14px',
    borderBottom: '1px solid rgba(0,0,0,.07)',
  },
  mTitle: { fontSize: 16, fontWeight: 700 },
  mBody: { padding: '16px 20px' },
  mTextarea: {
    width: '100%',
    borderRadius: 9,
    border: '1px solid rgba(0,0,0,.12)',
    padding: '9px 11px',
    fontSize: 13,
    resize: 'vertical' as const,
    minHeight: 64,
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  },
  mFooter: {
    display: 'flex',
    gap: 8,
    padding: '14px 20px 18px',
    borderTop: '1px solid rgba(0,0,0,.07)',
  },
  mBtnConfirm: (action: string): React.CSSProperties => ({
    flex: 1,
    padding: '9px 0',
    borderRadius: 9,
    border: 'none',
    background: action === 'approve' ? '#16A34A' : '#DC2626',
    color: '#fff',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  }),
  mBtnCancel: {
    padding: '9px 18px',
    borderRadius: 9,
    border: '1px solid rgba(0,0,0,.12)',
    background: 'transparent',
    fontWeight: 500,
    fontSize: 14,
    cursor: 'pointer',
  },
};

function timeAgo(date: string) {
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  if (h > 0) return `há ${h}h ${m % 60}min`;
  if (m < 1) return 'agora mesmo';
  return `há ${m}min`;
}

export function PendingPausesPanel() {
  const [requests, setRequests] = useState<PauseRequestItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [review, setReview] = useState<ReviewModalState | null>(null);
  const [reviewObs, setReviewObs] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.getPendingPauseRequests() as PauseRequestItem[];
      setRequests(data || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  // Adiciona nova solicitação em tempo real
  useRealtimePauseRequested((payload) => {
    setRequests((prev) => {
      if (prev.some((r) => r.id === payload.pauseRequestId)) return prev;
      return [
        {
          id: payload.pauseRequestId,
          agentId: payload.agentId,
          agentName: payload.agentName,
          reasonName: payload.reasonName,
          agentObservation: payload.agentObservation,
          requestedAt: payload.requestedAt,
          status: 'pending',
        },
        ...prev,
      ];
    });
    // Expande automaticamente ao receber solicitação nova
    setCollapsed(false);
  });

  // Remove da lista quando aprovada/rejeitada/cancelada
  useRealtimePauseEvents((event, payload) => {
    const removeStatuses = ['pause:approved', 'pause:rejected', 'pause:cancelled'];
    if (removeStatuses.includes(event)) {
      setRequests((prev) => prev.filter((r) => r.id !== payload.pauseRequestId));
    }
  });

  const openReview = (request: PauseRequestItem, action: 'approve' | 'reject') => {
    setReview({ request, action });
    setReviewObs('');
    setError('');
  };

  const handleConfirmReview = async () => {
    if (!review) return;
    setSubmitting(true);
    setError('');
    try {
      const data = { reviewerObservation: reviewObs.trim() || undefined };
      if (review.action === 'approve') {
        await api.approvePauseRequest(review.request.id, data);
      } else {
        await api.rejectPauseRequest(review.request.id, data);
      }
      setRequests((prev) => prev.filter((r) => r.id !== review.request.id));
      setReview(null);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erro ao processar a solicitação');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div style={S.panel}>
        <div style={S.header} onClick={() => setCollapsed((v) => !v)}>
          <div style={S.headerTitle}>
            <Bell size={16} color={requests.length > 0 ? '#DC2626' : '#9CA3AF'} />
            <span>Solicitações de pausa</span>
            <span style={S.badge(requests.length)}>{requests.length}</span>
          </div>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </div>

        {!collapsed && (
          <>
            {requests.length === 0 ? (
              <div style={S.empty}>Nenhuma solicitação pendente</div>
            ) : (
              requests.map((req) => (
                <div key={req.id} style={S.item}>
                  <div style={S.itemRow}>
                    <span style={S.agentName}>{req.agentName}</span>
                    <span style={S.reasonBadge}>{req.reasonName}</span>
                  </div>
                  {req.agentObservation && (
                    <div style={S.obs}>"{req.agentObservation}"</div>
                  )}
                  <div style={S.time}>
                    <Clock size={11} style={{ display: 'inline', marginRight: 4 }} />
                    {timeAgo(req.requestedAt)}
                  </div>
                  <div style={S.actions}>
                    <button style={S.btnApprove} onClick={() => openReview(req, 'approve')}>
                      <Check size={14} />
                      Aprovar
                    </button>
                    <button style={S.btnReject} onClick={() => openReview(req, 'reject')}>
                      <X size={14} />
                      Rejeitar
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* Modal de confirmação de revisão */}
      {review && (
        <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) setReview(null); }}>
          <div style={S.modal}>
            <div style={S.mHeader}>
              <span style={S.mTitle}>
                {review.action === 'approve' ? '✓ Aprovar pausa' : '✕ Rejeitar pausa'}
              </span>
              <button onClick={() => setReview(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <div style={S.mBody}>
              <div style={{ fontSize: 13, marginBottom: 12, color: 'var(--txt2, #555)' }}>
                <strong>{review.request.agentName}</strong> — {review.request.reasonName}
                {review.request.agentObservation && (
                  <div style={{ marginTop: 6, fontStyle: 'italic', color: '#6B7280' }}>
                    "{review.request.agentObservation}"
                  </div>
                )}
              </div>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--txt2, #555)' }}>
                Observação <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(opcional)</span>
              </label>
              <textarea
                style={S.mTextarea}
                placeholder={review.action === 'approve' ? 'Ex: Aprovado para até 30 minutos' : 'Ex: Aguarde o término do atendimento em andamento'}
                value={reviewObs}
                onChange={(e) => setReviewObs(e.target.value)}
                maxLength={500}
              />
              {error && <div style={{ color: '#DC2626', fontSize: 12, marginTop: 8 }}>{error}</div>}
            </div>
            <div style={S.mFooter}>
              <button
                onClick={handleConfirmReview}
                disabled={submitting}
                style={S.mBtnConfirm(review.action)}
              >
                {submitting ? 'Processando...' : review.action === 'approve' ? 'Confirmar aprovação' : 'Confirmar rejeição'}
              </button>
              <button onClick={() => setReview(null)} style={S.mBtnCancel}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
