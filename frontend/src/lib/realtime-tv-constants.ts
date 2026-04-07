/**
 * Fundação Modo TV NOC — constantes apenas (sem lógica).
 * Etapa 1: valores base para tema, SLA e tipografia.
 */

export const TV_COLORS = {
  background: '#0d0d0d',
  text: '#ffffff',
  critical: '#ff4d4d',
  warning: '#ffcc00',
  success: '#4dff88',
  info: '#4da6ff',
} as const;

export const TV_SLA_THRESHOLDS = {
  critical: 10,
  warning: 5,
} as const;

export const TV_FONT_SIZES = {
  title: 'text-4xl',
  number: 'text-5xl',
  label: 'text-2xl',
} as const;
