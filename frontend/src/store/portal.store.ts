import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PortalState {
  contact: any;
  client: any;
  clients: any[];
  accessToken: string | null;
  chatTicketId: string | null;
  chatConversationId: string | null;
  chatStep: 'form' | 'chat';
  chatClientId: string | null;
  setAuth: (data: { contact: any; clients: any[]; accessToken: string }) => void;
  selectClient: (client: any) => void;
  setChatState: (ticketId: string | null, conversationId: string | null, step: 'form' | 'chat', clientId?: string | null) => void;
  clearAuth: () => void;
}

export const usePortalStore = create<PortalState>()(
  persist(
    (set) => ({
      contact: null,
      client: null,
      clients: [],
      accessToken: null,
      chatTicketId: null,
      chatConversationId: null,
      chatStep: 'form',
      chatClientId: null,
      setAuth: (data) => set({
        contact: data.contact,
        clients: data.clients,
        client: data.clients.length === 1 ? data.clients[0] : null,
        accessToken: data.accessToken,
      }),
      selectClient: (client) => set({ client, chatTicketId: null, chatConversationId: null, chatStep: 'form', chatClientId: null }),
      setChatState: (ticketId, conversationId, step, clientId) => set({ chatTicketId: ticketId, chatConversationId: conversationId, chatStep: step, chatClientId: clientId ?? null }),
      clearAuth: () => set({ contact: null, client: null, clients: [], accessToken: null, chatTicketId: null, chatConversationId: null, chatStep: 'form', chatClientId: null }),
    }),
    { name: 'portal-auth' }
  )
);
