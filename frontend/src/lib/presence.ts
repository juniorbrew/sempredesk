export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

export const STATUS_STYLE: Record<PresenceStatus, { bg: string; color: string; label: string }> = {
  online: { bg: '#DCFCE7', color: '#15803D', label: 'Online' },
  away: { bg: '#FEF9C3', color: '#854D0E', label: 'Ausente' },
  busy: { bg: '#DBEAFE', color: '#1D4ED8', label: 'Ocupado' },
  offline: { bg: '#FEE2E2', color: '#DC2626', label: 'Offline' },
};
