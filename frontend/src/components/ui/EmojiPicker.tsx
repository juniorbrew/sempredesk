'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

// Carrega o picker apenas no cliente (evita SSR crash)
const Picker = dynamic(
  () => import('@emoji-mart/react').then(m => m.default),
  { ssr: false }
);

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  /** Posição do popup: 'top' (acima do botão, padrão) ou 'bottom' */
  position?: 'top' | 'bottom';
}

export function EmojiPicker({ onSelect, position = 'top' }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Carrega os dados de emoji uma vez
  useEffect(() => {
    import('@emoji-mart/data').then(d => setData(d.default));
  }, []);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (emoji: any) => {
    onSelect(emoji.native);
    setOpen(false);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Emojis"
        style={{
          padding: '5px 10px',
          borderRadius: 7,
          background: open ? '#EEF2FF' : 'transparent',
          border: 'none',
          fontSize: 12,
          color: open ? '#4F46E5' : '#64748B',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontFamily: 'inherit',
          transition: 'background .1s',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
          <line x1="9" y1="9" x2="9.01" y2="9"/>
          <line x1="15" y1="9" x2="15.01" y2="9"/>
        </svg>
        Emoji
      </button>

      {open && data && (
        <div
          style={{
            position: 'absolute',
            zIndex: 9999,
            ...(position === 'top'
              ? { bottom: '110%', left: 0 }
              : { top: '110%', left: 0 }),
          }}
        >
          <Picker
            data={data}
            onEmojiSelect={handleSelect}
            locale="pt"
            theme="light"
            previewPosition="none"
            skinTonePosition="none"
            searchPosition="top"
            navPosition="top"
            perLine={8}
            maxFrequentRows={2}
            set="native"
          />
        </div>
      )}
    </div>
  );
}
