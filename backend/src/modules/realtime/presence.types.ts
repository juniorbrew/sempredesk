export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

export interface UserPresence {
  userId: string;
  status: PresenceStatus;
  lastSeen: Date;
}

export const PRESENCE_HEARTBEAT_INTERVAL_MS = 15_000;
export const PRESENCE_OFFLINE_THRESHOLD_MS = 45_000;
