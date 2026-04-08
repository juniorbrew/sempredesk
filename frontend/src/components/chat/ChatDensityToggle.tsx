'use client';

import type { ChatDensityMode } from '@/components/chat/chatDensity';

type Props = {
  value: ChatDensityMode;
  onChange: (mode: ChatDensityMode) => void;
};

const segmentBase = {
  border: 'none',
  cursor: 'pointer' as const,
  fontFamily: 'inherit' as const,
  fontSize: 11,
  fontWeight: 600,
  padding: '6px 11px',
  lineHeight: 1.2,
  transition: 'background 0.15s ease, color 0.15s ease',
};

/**
 * Alternância Normal / Compacto para densidade da lista de mensagens (atendimento).
 */
export default function ChatDensityToggle({ value, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Densidade da conversa"
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        borderRadius: 8,
        border: '1px solid rgba(15, 23, 42, 0.12)',
        background: '#FFFFFF',
        overflow: 'hidden',
        flexShrink: 0,
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
      }}
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === 'normal'}
        onClick={() => onChange('normal')}
        style={{
          ...segmentBase,
          background: value === 'normal' ? '#0F172A' : 'transparent',
          color: value === 'normal' ? '#FFFFFF' : '#64748B',
        }}
        onMouseEnter={(e) => {
          if (value !== 'normal') e.currentTarget.style.background = '#F1F5F9';
        }}
        onMouseLeave={(e) => {
          if (value !== 'normal') e.currentTarget.style.background = 'transparent';
        }}
      >
        Normal
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'compact'}
        onClick={() => onChange('compact')}
        style={{
          ...segmentBase,
          borderLeft: '1px solid rgba(15, 23, 42, 0.08)',
          background: value === 'compact' ? '#0F172A' : 'transparent',
          color: value === 'compact' ? '#FFFFFF' : '#64748B',
        }}
        onMouseEnter={(e) => {
          if (value !== 'compact') e.currentTarget.style.background = '#F1F5F9';
        }}
        onMouseLeave={(e) => {
          if (value !== 'compact') e.currentTarget.style.background = 'transparent';
        }}
      >
        Compacto
      </button>
    </div>
  );
}
