import type { StatusType, PriorityType, ChannelType } from '@/types/shared.types';

export const STATUS_COLORS: Record<StatusType, { bg: string; text: string; border: string; dot: string }> = {
  aberto:       { bg: '#EEF2FF', text: '#3730A3', border: '#C7D2FE', dot: '#4F46E5' },
  em_andamento: { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A', dot: '#F59E0B' },
  aguardando:   { bg: '#F0F9FF', text: '#0369A1', border: '#BAE6FD', dot: '#0EA5E9' },
  resolvido:    { bg: '#F0FDF4', text: '#166534', border: '#BBF7D0', dot: '#22C55E' },
  fechado:      { bg: '#F9FAFB', text: '#374151', border: '#E5E7EB', dot: '#9CA3AF' },
  cancelado:    { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA', dot: '#EF4444' },
};

export const STATUS_LABELS: Record<StatusType, string> = {
  aberto:       'Aberto',
  em_andamento: 'Em andamento',
  aguardando:   'Aguardando',
  resolvido:    'Resolvido',
  fechado:      'Fechado',
  cancelado:    'Cancelado',
};

export const PRIORITY_COLORS: Record<PriorityType, { bg: string; text: string }> = {
  baixa:   { bg: '#F0FDF4', text: '#166534' },
  media:   { bg: '#FEF3C7', text: '#92400E' },
  alta:    { bg: '#FFF7ED', text: '#C2410C' },
  critica: { bg: '#FDF4FF', text: '#7E22CE' },
};

export const PRIORITY_LABELS: Record<PriorityType, string> = {
  baixa:   'Baixa',
  media:   'Média',
  alta:    'Alta',
  critica: 'Crítica',
};

export const CHANNEL_COLORS: Record<ChannelType, { bg: string; text: string }> = {
  whatsapp: { bg: '#DCFCE7', text: '#15803D' },
  portal:   { bg: '#EEF2FF', text: '#4F46E5' },
};

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  whatsapp: 'WhatsApp',
  portal:   'Portal',
};

export const AVATAR_COLORS = [
  '#16A34A', // green
  '#2563EB', // blue
  '#EA580C', // orange
  '#7C3AED', // purple
  '#E11D48', // rose
  '#4F46E5', // indigo
  '#0891B2', // cyan
  '#B45309', // amber
] as const;
