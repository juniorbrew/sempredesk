'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export type AudioMessagePlayerVariant = 'sent' | 'received';

type Props = {
  src: string;
  variant: AudioMessagePlayerVariant;
  className?: string;
};

/**
 * Player compacto para mensagens de áudio (substitui &lt;audio controls&gt; nativo).
 * Usa a mesma URL de mídia já autenticada/fornecida pelo inbox.
 */
export default function AudioMessagePlayer({ src, variant, className }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const isSent = variant === 'sent';
  const fg = isSent ? 'rgba(255,255,255,0.95)' : '#0F172A';
  const muted = isSent ? 'rgba(255,255,255,0.55)' : '#64748B';
  const trackBg = isSent ? 'rgba(255,255,255,0.25)' : 'rgba(15,23,42,0.12)';
  const fillBg = isSent ? 'rgba(255,255,255,0.85)' : '#2563EB';

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const seekFromClientX = useCallback((clientX: number) => {
    const el = audioRef.current;
    const bar = barRef.current;
    if (!el || !bar || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    setCurrent(el.currentTime);
  }, []);

  const onBarPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      seekFromClientX(e.clientX);
    },
    [seekFromClientX],
  );

  const onBarPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.buttons !== 1 && e.pointerType !== 'touch') return;
      seekFromClientX(e.clientX);
    },
    [seekFromClientX],
  );

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
    };
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
    };
  }, [src]);

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const durationLabel = duration > 0 ? formatTime(duration) : '--:--';
  const currentLabel = duration > 0 || current > 0 ? formatTime(current) : '0:00';

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 200,
        maxWidth: 280,
      }}
    >
      <audio ref={audioRef} src={src} preload="metadata" style={{ display: 'none' }} />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isSent ? 'rgba(255,255,255,0.22)' : 'rgba(37,99,235,0.12)',
          color: fg,
        }}
      >
        {playing ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} style={{ marginLeft: 2 }} />}
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onKeyDown={(e) => {
            const el = audioRef.current;
            if (!el || !Number.isFinite(el.duration)) return;
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              el.currentTime = Math.min(el.duration, el.currentTime + 5);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              el.currentTime = Math.max(0, el.currentTime - 5);
            }
          }}
          style={{
            height: 5,
            borderRadius: 99,
            background: trackBg,
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              background: fillBg,
              borderRadius: 99,
              pointerEvents: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: muted, lineHeight: 1.2 }}>
          <span>{currentLabel}</span>
          <span>{durationLabel}</span>
        </div>
      </div>
    </div>
  );
}
