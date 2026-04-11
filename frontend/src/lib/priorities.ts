export const PRIORITY_VALUES = ['low', 'medium', 'high', 'critical'] as const;

export type SystemPriority = (typeof PRIORITY_VALUES)[number];

export const DEFAULT_PRIORITY: SystemPriority = 'medium';

export const PRIORITY_LABELS: Record<SystemPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

export const PRIORITY_COLORS: Record<SystemPriority, { bg: string; color: string }> = {
  low: { bg: '#F0FDF4', color: '#166534' },
  medium: { bg: '#FEF3C7', color: '#92400E' },
  high: { bg: '#FFF7ED', color: '#C2410C' },
  critical: { bg: '#FDF2F8', color: '#86198F' },
};

export const PRIORITY_OPTIONS = PRIORITY_VALUES.map((value) => ({
  value,
  label: PRIORITY_LABELS[value],
}));
