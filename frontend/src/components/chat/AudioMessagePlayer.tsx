'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { DEFAULT_CHAT_DENSITY_MODE, type ChatDensityMode } from '@/components/chat/chatDensity';

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
  density?: ChatDensityMode;
};

/** Player compacto; escala com `density` (normal = confortável, compact = mais fino). */
export default function AudioMessagePlayer({ src, variant, className, density = DEFAULT_CHAT_DENSITY_MODE }: Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const isSent = variant === 'sent';
  const fg = isDark ? '#CBD5E1' : '#475569';
  const muted = isDark ? '#64748B' : '#94A3B8';
  const trackBg =
    isDark
      ? isSent
        ? 'rgba(255,255,255,0.1)'
        : 'rgba(255,255,255,0.08)'
      : isSent
        ? 'rgba(71,85,105,0.12)'
        : 'rgba(71,85,105,0.1)';
  const fillBg = isDark ? (isSent ? '#A5B4FC' : '#60A5FA') : isSent ? '#6366F1' : '#3B82F6';
  const compact = density === 'compact';
  const btnSize = compact ? 26 : 32;
  const iconPx = compact ? 12 : 15;
  const barH = compact ? 2.5 : 4;
  const rowGap = compact ? 1 : 2;
  const outerGap = compact ? 5 : 6;
  const timeFont = compact ? 9 : 10;
  const minW = compact ? 140 : 160;
  /** Teto horizontal vem do contentor da bolha (`width: 100%` + `maxWidth` no pai). */
  const maxW = '100%';
  const btnBg = isDark
    ? isSent
      ? 'rgba(165,180,252,0.2)'
      : 'rgba(96,165,250,0.18)'
    : isSent
      ? 'rgba(99,102,241,0.12)'
      : 'rgba(59,130,246,0.1)';

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
        gap: outerGap,
        width: '100%',
        minWidth: minW,
        maxWidth: maxW,
        padding: compact ? '1px 0' : '2px 0',
        boxSizing: 'border-box',
      }}
    >
      <audio ref={audioRef} src={src} preload="metadata" style={{ display: 'none' }} />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
        style={{
          width: btnSize,
          height: btnSize,
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: btnBg,
          color: fg,
        }}
      >
        {playing ? <Pause size={iconPx} strokeWidth={2} /> : <Play size={iconPx} strokeWidth={2} style={{ marginLeft: 1 }} />}
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: rowGap }}>
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
            height: barH,
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
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: timeFont, color: muted, lineHeight: 1.15 }}>
          <span>{currentLabel}</span>
          <span>{durationLabel}</span>
        </div>
      </div>
    </div>
  );
}
