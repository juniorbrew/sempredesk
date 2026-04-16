'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePresence } from '@/components/PresenceProvider';
import { usePresenceStore } from '@/store/presence.store';
import { useAuthStore } from '@/store/auth.store';
import { ChevronDown, Coffee, Clock } from 'lucide-react';
import { STATUS_STYLE } from '@/lib/presence';
import { api } from '@/lib/api';
import { useRealtimeMyPauseStatus } from '@/lib/realtime';
import { PauseRequestModal } from '@/components/pause/PauseRequestModal';

const STATUS_OPTIONS = (['online', 'away', 'busy'] as const).map((v) => ({
  value: v,
  label: STATUS_STYLE[v].label,
  color: STATUS_STYLE[v].color,
}));

interface PauseState {
  id: string;
  status: 'pending' | 'active' | 'rejected' | 'finished' | 'cancelled';
  reasonName: string;
  requestedAt: string;
  startedAt?: string;
  agentObservation?: string;
  maxDurationMinutes?: number | null;
}

export function StatusSelector() {
  const { user } = useAuthStore();
  const { setStatus, isConnected } = usePresence();
  const myStatus = usePresenceStore((s) => user?.id ? (s.statusMap[user.id] || 'offline') : 'offline');
  const [open, setOpen] = useState(false);
  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [currentPause, setCurrentPause] = useState<PauseState | null>(null);
  const [loadingPause, setLoadingPause] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = myStatus === 'offline'
    ? { value: 'offline' as const, label: STATUS_STYLE.offline.label, color: STATUS_STYLE.offline.color }
    : STATUS_OPTIONS.find((o) => o.value === myStatus) || STATUS_OPTIONS[0];

  // Carrega o estado de pausa atual ao montar
  const loadPauseState = useCallback(async () => {
    if (!user?.id) return;
    setLoadingPause(true);
    try {
      const data = await api.getMyPauseState() as PauseState | null;
      setCurrentPause(data);
    } catch {
      // silencioso — não bloqueia se falhar
    } finally {
      setLoadingPause(false);
    }
  }, [user?.id]);

  useEffect(() => { loadPauseState(); }, [loadPauseState]);

  // Escuta mudanças de status de pausa em tempo real
  useRealtimeMyPauseStatus(user?.id ?? null, (payload) => {
    if (payload.status === 'active') {
      // Recarrega para obter o startedAt correto
      loadPauseState();
    } else if (payload.status === 'finished' || payload.status === 'rejected' || payload.status === 'cancelled') {
      setCurrentPause(null);
    }
  });

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, []);

  if (!user?.id) return null;

  // ── Indicador de pausa pendente ou ativa ──────────────────────────────────────
  const isPaused = currentPause?.status === 'active';
  const isPending = currentPause?.status === 'pending';

  const pauseIndicatorColor = isPaused ? '#7C3AED' : isPending ? '#D97706' : null;
  const pauseIndicatorLabel = isPaused ? 'Em pausa' : isPending ? 'Pausa pend.' : null;

  return (
    <>
      <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Botão principal de status */}
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 10,
            border: pauseIndicatorColor
              ? `1px solid ${pauseIndicatorColor}55`
              : '1px solid rgba(255,255,255,0.1)',
            background: pauseIndicatorColor
              ? `${pauseIndicatorColor}22`
              : '#1E293B',
            color: pauseIndicatorColor ?? '#E2E8F0',
            fontSize: 13,
            cursor: 'pointer',
            transition: 'all .2s',
          }}
        >
          {isPaused || isPending ? (
            <>
              {isPaused
                ? <Coffee size={13} color={pauseIndicatorColor!} />
                : <Clock size={13} color={pauseIndicatorColor!} />
              }
              <span style={{ fontWeight: 600 }}>{pauseIndicatorLabel}</span>
            </>
          ) : (
            <>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: isConnected ? current.color : '#94A3B8',
                }}
              />
              {current.label}
            </>
          )}
          <ChevronDown className="w-4 h-4" style={{ opacity: open ? 1 : 0.7 }} />
        </button>

        {/* Dropdown */}
        {open && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 6,
              background: '#1E293B',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
              minWidth: 180,
              zIndex: 50,
              overflow: 'hidden',
            }}
          >
            {/* Status de presença — só mostra se não estiver em pausa ativa */}
            {!isPaused && !isPending && STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setStatus(opt.value);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '10px 14px',
                  background: myStatus === opt.value ? 'rgba(99,102,241,0.15)' : 'transparent',
                  border: 'none',
                  color: '#E2E8F0',
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.color }} />
                {opt.label}
              </button>
            ))}

            {/* Separador antes da opção de pausa */}
            {!isPaused && !isPending && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />
            )}

            {/* Opção de pausa */}
            {!isPaused && !isPending ? (
              <button
                onClick={() => {
                  setOpen(false);
                  setPauseModalOpen(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  color: '#C4B5FD',
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <Coffee size={14} color="#C4B5FD" />
                Solicitar pausa
              </button>
            ) : (
              // Em pausa ou pendente: mostra opção de gerenciar
              <button
                onClick={() => {
                  setOpen(false);
                  setPauseModalOpen(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  color: isPaused ? '#C4B5FD' : '#FCD34D',
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontWeight: 600,
                }}
              >
                {isPaused
                  ? <><Coffee size={14} /> Encerrar pausa</>
                  : <><Clock size={14} /> Ver solicitação</>
                }
              </button>
            )}
          </div>
        )}
      </div>

      {/* Modal de pausa */}
      <PauseRequestModal
        open={pauseModalOpen}
        onClose={() => setPauseModalOpen(false)}
        currentPause={currentPause}
        onPauseRequested={(pause) => setCurrentPause(pause as PauseState)}
        onPauseEnded={() => {
          setCurrentPause(null);
          // Restaura presença para online — o backend já faz, mas garante no frontend
          setStatus('online');
        }}
      />
    </>
  );
}
