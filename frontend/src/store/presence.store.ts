'use client';
import { create } from 'zustand';

export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

interface PresenceStore {
  onlineIds: Set<string>;
  statusMap: Record<string, PresenceStatus>;
  setPresence: (onlineIds: string[], statusMap?: Record<string, string>) => void;
  setOnlineIds: (ids: string[] | Set<string>) => void;
  isOnline: (id: string) => boolean;
  getStatus: (id: string) => PresenceStatus;
}

export const usePresenceStore = create<PresenceStore>((set, get) => ({
  onlineIds: new Set(),
  statusMap: {},
  setPresence: (onlineIds, statusMap = {}) =>
    set({
      onlineIds: new Set(onlineIds.map(String)),
      statusMap: Object.fromEntries(
        Object.entries(statusMap).map(([k, v]) => [k, (v as PresenceStatus) || 'offline']),
      ),
    }),
  setOnlineIds: (ids) =>
    set({ onlineIds: ids instanceof Set ? ids : new Set(ids) }),
  isOnline: (id) => get().onlineIds.has(String(id)),
  getStatus: (id) => get().statusMap[String(id)] || 'offline',
}));

/** Hook para re-render apenas quando o status do agente mudar (evita re-render da lista inteira) */
export function useAgentStatus(agentId: string | null): PresenceStatus {
  return usePresenceStore((s) => (agentId ? (s.statusMap[String(agentId)] || 'offline') : 'offline'));
}
