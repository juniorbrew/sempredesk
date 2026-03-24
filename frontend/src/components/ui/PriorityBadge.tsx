import { PRIORITY_COLORS, PRIORITY_LABELS } from '@/lib/tokens';
import type { PriorityType } from '@/types/shared.types';

const PRIORITY_ICONS: Record<PriorityType, string> = {
  baixa:   '↓',
  media:   '→',
  alta:    '↑',
  critica: '⚡',
};

interface PriorityBadgeProps {
  priority: PriorityType;
  size?: 'sm' | 'md';
}

export default function PriorityBadge({ priority, size = 'md' }: PriorityBadgeProps) {
  const { bg, text } = PRIORITY_COLORS[priority];
  const label = PRIORITY_LABELS[priority];
  const icon = PRIORITY_ICONS[priority];

  const padding = size === 'sm' ? '2px 8px' : '3px 10px';
  const fontSize = size === 'sm' ? 10 : 11;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding,
        borderRadius: 99,
        background: bg,
        color: text,
        fontSize,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: fontSize + 1, lineHeight: 1 }}>{icon}</span>
      {label}
    </span>
  );
}
