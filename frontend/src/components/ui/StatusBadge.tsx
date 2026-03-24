import { STATUS_COLORS, STATUS_LABELS } from '@/lib/tokens';
import type { StatusType } from '@/types/shared.types';

interface StatusBadgeProps {
  status: StatusType;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const { bg, text, border, dot } = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];

  const padding = size === 'sm' ? '2px 8px' : '3px 10px';
  const fontSize = size === 'sm' ? 10 : 11;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding,
        borderRadius: 99,
        border: `1px solid ${border}`,
        background: bg,
        color: text,
        fontSize,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dot,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}
