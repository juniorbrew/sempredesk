/**
 * Densidade visual da conversa no atendimento (híbrido WhatsApp + corporativo leve).
 * Persistência opcional via `readChatDensityFromStorage` / `writeChatDensityToStorage`.
 */
export type ChatDensityMode = 'normal' | 'compact';

export const DEFAULT_CHAT_DENSITY_MODE: ChatDensityMode = 'normal';

export const CHAT_DENSITY_STORAGE_KEY = 'sempredesk-attendance-chat-density';

export function readChatDensityFromStorage(): ChatDensityMode {
  if (typeof window === 'undefined') return DEFAULT_CHAT_DENSITY_MODE;
  try {
    const v = localStorage.getItem(CHAT_DENSITY_STORAGE_KEY);
    if (v === 'compact' || v === 'normal') return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_CHAT_DENSITY_MODE;
}

export function writeChatDensityToStorage(mode: ChatDensityMode): void {
  try {
    localStorage.setItem(CHAT_DENSITY_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}
