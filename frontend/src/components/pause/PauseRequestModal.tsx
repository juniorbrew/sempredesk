'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { Coffee, Clock, X, AlertCircle } from 'lucide-react';

interface PauseReason {
  id: string;
  name: string;
  description?: string;
  requiresApproval: boolean;
  maxDurationMinutes: number | null;
}

interface PauseRequest {
  id: string;
  status: 'pending' | 'active' | 'rejected' | 'finished' | 'cancelled';
  reasonName: string;
  requestedAt: string;
  startedAt?: string;
  agentObservation?: string;
  maxDurationMinutes?: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pausa ativa ou pendente existente */
  currentPause: PauseRequest | null;
  onPauseRequested: (pause: PauseRequest) => void;
  onPauseEnded: () => void;
}

const S = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modal: {
    background: 'var(--bg, #fff)',
    borderRadius: 16,
    width: '100%',
    maxWidth: 480,
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px 16px',
    borderBottom: '1px solid rgba(0,0,0,.07)',
  },
  title: { fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 },
  body: { padding: '20px 24px' },
  label: { fontSize: 13, fontWeight: 600, color: 'var(--txt2, #555)', marginBottom: 8, display: 'block' },
  reasonBtn: (selected: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '10px 14px',
    borderRadius: 10,
    border: selected ? '2px solid #4F46E5' : '1px solid rgba(0,0,0,.1)',
    background: selected ? '#EEF2FF' : 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: selected ? 600 : 400,
    color: selected ? '#4F46E5' : 'var(--txt, #111)',
    marginBottom: 6,
    transition: 'all .15s',
  }),
  textarea: {
    width: '100%',
    borderRadius: 10,
    border: '1px solid rgba(0,0,0,.12)',
    padding: '10px 12px',
    fontSize: 14,
    resize: 'vertical' as const,
    minHeight: 72,
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  },
  footer: {
    display: 'flex',
    gap: 10,
    padding: '16px 24px 20px',
    borderTop: '1px solid rgba(0,0,0,.07)',
  },
  btnPrimary: {
    flex: 1,
    padding: '10px 0',
    borderRadius: 10,
    border: 'none',
    background: '#4F46E5',
    color: '#fff',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  btnDanger: {
    flex: 1,
    padding: '10px 0',
    borderRadius: 10,
    border: 'none',
    background: '#DC2626',
    color: '#fff',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  btnSecondary: {
    padding: '10px 20px',
    borderRadius: 10,
    border: '1px solid rgba(0,0,0,.15)',
    background: 'transparent',
    color: 'var(--txt, #111)',
    fontWeight: 500,
    fontSize: 14,
    cursor: 'pointer',
  },
};

/** Formata segundos decorridos como HH:MM:SS */
function clockDuration(startedAt: string) {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

/** Conta regressiva em HH:MM:SS */
function clockCountdown(startedAt: string, maxMinutes: number) {
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const remaining = Math.max(0, maxMinutes * 60 - elapsed);
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

/** Segundos restantes (negativo = já expirou) */
function remainingSeconds(startedAt: string, maxMinutes: number) {
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  return maxMinutes * 60 - elapsed;
}

/** Rótulo legível da duração máxima */
function durationLabel(minutes: number | null): string {
  if (!minutes) return 'Livre';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

export function PauseRequestModal({ open, onClose, currentPause, onPauseRequested, onPauseEnded }: Props) {
  const [reasons, setReasons] = useState<PauseReason[]>([]);
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [observation, setObservation] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingReasons, setLoadingReasons] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const autoEndFiredRef = useRef(false);

  // Relógio (contagem ou regressiva)
  useEffect(() => {
    if (!currentPause || currentPause.status !== 'active') return;
    const t = setInterval(() => setTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, [currentPause]);

  // Encerramento automático ao atingir o tempo limite
  useEffect(() => {
    if (
      currentPause?.status === 'active' &&
      currentPause.maxDurationMinutes &&
      currentPause.startedAt &&
      !autoEndFiredRef.current &&
      !loading
    ) {
      const rem = remainingSeconds(currentPause.startedAt, currentPause.maxDurationMinutes);
      if (rem <= 0) {
        autoEndFiredRef.current = true;
        handleEnd();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // Reset do guard de auto-end quando muda a pausa
  useEffect(() => {
    autoEndFiredRef.current = false;
  }, [currentPause?.id]);

  const loadReasons = useCallback(async () => {
    setLoadingReasons(true);
    try {
      const data = await api.getPauseReasons() as PauseReason[];
      setReasons(data);
    } catch {
      setError('Não foi possível carregar os motivos de pausa');
    } finally {
      setLoadingReasons(false);
    }
  }, []);

  useEffect(() => {
    if (open && !currentPause) loadReasons();
    if (!open) {
      setSelectedReason('');
      setObservation('');
      setError('');
    }
  }, [open, currentPause, loadReasons]);

  const handleRequest = async () => {
    if (!selectedReason) { setError('Selecione um motivo'); return; }
    setLoading(true);
    setError('');
    try {
      const result = await api.requestPause({
        reasonId: selectedReason,
        agentObservation: observation.trim() || undefined,
      }) as PauseRequest;
      onPauseRequested(result);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erro ao solicitar pausa');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!currentPause) return;
    setLoading(true);
    setError('');
    try {
      await api.cancelPauseRequest();
      onPauseEnded();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erro ao cancelar solicitação');
    } finally {
      setLoading(false);
    }
  };

  const handleEnd = async () => {
    setLoading(true);
    setError('');
    try {
      await api.endMyPause();
      onPauseEnded();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erro ao encerrar pausa');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  // ── Pausa PENDENTE ────────────────────────────────────────────────────────────
  if (currentPause?.status === 'pending') {
    return (
      <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={S.modal}>
          <div style={S.header}>
            <div style={S.title}>
              <Clock size={20} color="#D97706" />
              <span>Pausa pendente</span>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>
          <div style={S.body}>
            <div style={{ padding: '16px', background: '#FFFBEB', borderRadius: 10, border: '1px solid #FDE68A', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>
                Aguardando aprovação do supervisor
              </div>
              <div style={{ fontSize: 13, color: '#78350F' }}>
                Motivo: <strong>{currentPause.reasonName}</strong>
              </div>
              {currentPause.maxDurationMinutes && (
                <div style={{ fontSize: 13, color: '#78350F', marginTop: 4 }}>
                  Duração: <strong>{durationLabel(currentPause.maxDurationMinutes)}</strong>
                </div>
              )}
              {currentPause.agentObservation && (
                <div style={{ fontSize: 13, color: '#78350F', marginTop: 4 }}>
                  Observação: {currentPause.agentObservation}
                </div>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--txt2, #555)' }}>
              Você continua disponível para atendimento até a aprovação.
            </div>
            {error && <div style={{ color: '#DC2626', fontSize: 13, marginTop: 10 }}>{error}</div>}
          </div>
          <div style={S.footer}>
            <button onClick={handleCancel} disabled={loading} style={S.btnDanger}>
              {loading ? 'Cancelando...' : 'Cancelar solicitação'}
            </button>
            <button onClick={onClose} style={S.btnSecondary}>Fechar</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Pausa ATIVA ───────────────────────────────────────────────────────────────
  if (currentPause?.status === 'active') {
    const hasLimit = !!(currentPause.maxDurationMinutes && currentPause.startedAt);
    const rem = hasLimit
      ? remainingSeconds(currentPause.startedAt!, currentPause.maxDurationMinutes!)
      : null;
    const isNearEnd = rem !== null && rem <= 60;
    const timerColor = isNearEnd ? '#DC2626' : '#7C3AED';
    const timeDisplay = hasLimit && currentPause.startedAt
      ? clockCountdown(currentPause.startedAt, currentPause.maxDurationMinutes!)
      : currentPause.startedAt ? clockDuration(currentPause.startedAt) : '00:00:00';

    return (
      <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={S.modal}>
          <div style={S.header}>
            <div style={S.title}>
              <Coffee size={20} color="#7C3AED" />
              <span>Em pausa</span>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>
          <div style={S.body}>
            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase' }}>
                {hasLimit ? 'Tempo restante' : 'Tempo decorrido'}
              </div>
              <div style={{
                fontSize: 42, fontWeight: 700, color: timerColor,
                fontVariantNumeric: 'tabular-nums', letterSpacing: 2,
                transition: 'color .3s',
              }}>
                {timeDisplay}
              </div>
              <div style={{ fontSize: 14, color: 'var(--txt2, #555)', marginTop: 6 }}>
                {currentPause.reasonName}
                {currentPause.maxDurationMinutes && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#9CA3AF' }}>
                    · {durationLabel(currentPause.maxDurationMinutes)}
                  </span>
                )}
              </div>
            </div>
            {isNearEnd && (
              <div style={{ padding: '10px 14px', background: '#FEF2F2', borderRadius: 10, border: '1px solid #FECACA', fontSize: 13, color: '#DC2626', fontWeight: 600, marginBottom: 12 }}>
                Tempo quase esgotado — a pausa será encerrada automaticamente.
              </div>
            )}
            <div style={{ padding: '12px', background: '#F3F0FF', borderRadius: 10, border: '1px solid #DDD6FE', fontSize: 13, color: '#5B21B6' }}>
              Você está fora da distribuição automática de atendimentos.
            </div>
            {error && <div style={{ color: '#DC2626', fontSize: 13, marginTop: 10 }}>{error}</div>}
          </div>
          <div style={S.footer}>
            <button onClick={handleEnd} disabled={loading} style={S.btnPrimary}>
              {loading ? 'Encerrando...' : 'Encerrar pausa'}
            </button>
            <button onClick={onClose} style={S.btnSecondary}>Fechar</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Nova solicitação ──────────────────────────────────────────────────────────
  return (
    <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.modal}>
        <div style={S.header}>
          <div style={S.title}>
            <Coffee size={20} color="#4F46E5" />
            <span>Solicitar pausa</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        <div style={S.body}>
          <label style={S.label}>Motivo da pausa</label>
          {loadingReasons ? (
            <div style={{ fontSize: 13, color: 'var(--txt2, #555)', padding: '8px 0' }}>Carregando motivos...</div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {reasons.map((r) => (
                <button
                  key={r.id}
                  style={S.reasonBtn(selectedReason === r.id)}
                  onClick={() => setSelectedReason(r.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>{r.name}</span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: selectedReason === r.id ? '#6366F1' : '#9CA3AF',
                      background: selectedReason === r.id ? '#E0E7FF' : '#F3F4F6',
                      borderRadius: 6,
                      padding: '2px 7px',
                    }}>
                      {durationLabel(r.maxDurationMinutes)}
                    </span>
                  </div>
                  {r.requiresApproval && (
                    <div style={{ fontSize: 11, color: selectedReason === r.id ? '#6366F1' : '#9CA3AF', marginTop: 2 }}>
                      Requer aprovação do supervisor
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          <label style={S.label}>Observação <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(opcional)</span></label>
          <textarea
            style={S.textarea}
            placeholder="Detalhes adicionais sobre a pausa..."
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            maxLength={500}
          />

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#DC2626', fontSize: 13, marginTop: 10 }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>
        <div style={S.footer}>
          <button
            onClick={handleRequest}
            disabled={loading || !selectedReason}
            style={{ ...S.btnPrimary, opacity: (!selectedReason || loading) ? 0.6 : 1 }}
          >
            {loading ? 'Solicitando...' : 'Solicitar pausa'}
          </button>
          <button onClick={onClose} style={S.btnSecondary}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
