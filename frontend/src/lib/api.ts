import axios, { AxiosInstance } from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
  : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000') + '/api/v1';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({ baseURL: BASE_URL });

    this.client.interceptors.request.use((config) => {
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('accessToken');
        if (token) config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (res) => res.data?.data ?? res.data,
      async (err) => {
        if (err.response?.status === 401 && typeof window !== 'undefined') {
          const refresh = localStorage.getItem('refreshToken');
          if (refresh) {
            try {
              const r = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken: refresh });
              const { accessToken } = r.data?.data ?? r.data;
              localStorage.setItem('accessToken', accessToken);
              err.config.headers.Authorization = `Bearer ${accessToken}`;
              return this.client.request(err.config);
            } catch {
              localStorage.clear();
              window.location.href = '/auth/login';
            }
          }
        }
        // Normalize NestJS validation errors: message can be string or string[]
        if (err.response?.data) {
          const msg = err.response.data.message;
          if (Array.isArray(msg)) err.response.data.message = msg.join('; ');
        }
        return Promise.reject(err);
      }
    );
  }

  login = (email: string, password: string) => this.client.post('/auth/login', { email, password });
  me = () => this.client.get('/auth/me');
  getMyPermissions = () => this.client.get('/auth/permissions');
  refresh = (refreshToken: string) => this.client.post('/auth/refresh', { refreshToken });

  dashboardSummary = () => this.client.get('/dashboard/summary');
  dashboardByPriority = () => this.client.get('/dashboard/tickets-by-priority');
  dashboardTrend = (days = 7) => this.client.get(`/dashboard/ticket-trend?days=${days}`);
  slaReport = () => this.client.get('/dashboard/sla-report');

  getTickets = (params?: any) => this.client.get('/tickets', { params });
  getTicket = (id: string) => this.client.get(`/tickets/${id}`);
  getTicketConversations = (params?: { origin?: 'portal' | 'whatsapp'; status?: string; perPage?: number }) =>
    this.client.get('/tickets/conversations', { params });
  getTicketByNumber = (number: string, clientId: string) =>
    this.client.get(`/tickets/by-number/${encodeURIComponent(number)}`, { params: { clientId } });
  createTicket = (data: any) => this.client.post('/tickets', data);
  updateTicket = (id: string, data: any) => this.client.put(`/tickets/${id}`, data);
  ticketStats = () => this.client.get('/tickets/stats');
  getMessages = (id: string, includeInternal = true) => this.client.get(`/tickets/${id}/messages`, { params: { includeInternal } });
  addMessage = (id: string, data: any) => this.client.post(`/tickets/${id}/messages`, data);
  sendWhatsappFromTicket = (ticketId: string, text: string) =>
    this.client.post('/webhooks/whatsapp/send-from-ticket', { ticketId, text });
  checkWhatsappNumber = (phone: string) =>
    this.client.post('/webhooks/whatsapp/check-number', { phone });
  startOutboundConversation = (data: { phone?: string; contactId?: string; clientId?: string; subject?: string; firstMessage?: string }) =>
    this.client.post('/webhooks/whatsapp/start-outbound', data);

  getConversations = (params?: { channel?: string; hasTicket?: string; status?: string }) =>
    this.client.get('/conversations', { params });
  getConversationsActiveCount = () => this.client.get('/conversations/active-count');
  getConversation = (id: string) => this.client.get(`/conversations/${id}`);
  getConversationMessages = (id: string, params?: { limit?: number; before?: string }) =>
    this.client.get(`/conversations/${id}/messages`, { params });
  addConversationMessage = (id: string, data: { content: string }) => this.client.post(`/conversations/${id}/messages`, data);
  updateConversationTags = (id: string, tags: string[]) => this.client.put(`/conversations/${id}/tags`, { tags });
  getConversationsByClient = (clientId: string, channel?: string) =>
    this.client.get(`/conversations/by-client/${clientId}`, { params: channel ? { channel } : {} });
  startAgentConversation = (data: { clientId: string; contactId: string; channel: string }) =>
    this.client.post('/conversations/start-by-agent', data);
  createTicketForConversation = (conversationId: string, data?: { subject?: string }) =>
    this.client.post(`/conversations/${conversationId}/create-ticket`, data || {});
  linkTicketToConversation = (conversationId: string, ticketId: string) =>
    this.client.post(`/conversations/${conversationId}/link-ticket`, { ticketId });
  closeConversation = (id: string, opts?: { keepTicketOpen?: boolean; solution?: string; rootCause?: string; timeSpentMin?: number; internalNote?: string; complexity?: number }) =>
    this.client.post(`/conversations/${id}/close`, opts || {});
  markConversationRead = (id: string) => this.client.post(`/conversations/${id}/mark-read`);
  assignTicket = (id: string, techId: string) => this.client.post(`/tickets/${id}/assign`, { techId });
  updateTicketContent = (id: string, data: { subject: string; description?: string }) => this.client.put(`/tickets/${id}/content`, data);
  getAttendanceQueueStats = () => this.client.get('/attendance/queue-stats');
  resolveTicket = (id: string, data?: any) => this.client.post(`/tickets/${id}/resolve`, data || {});
  closeTicket = (id: string) => this.client.post(`/tickets/${id}/close`);
  cancelTicket = (id: string, data?: any) => this.client.post(`/tickets/${id}/cancel`, data || {});
  escalateTicket = (id: string) => this.client.post(`/tickets/${id}/escalate`);
  submitSatisfaction = (id: string, score: 'approved' | 'rejected') => this.client.post(`/tickets/${id}/satisfaction`, { score });

  getTicketSettings = (params?: any) => this.client.get('/ticket-settings', { params });
  getTicketSettingsTree = () => this.client.get('/ticket-settings/tree');
  createTicketSetting = (data: any) => this.client.post('/ticket-settings', data);
  updateTicketSetting = (id: string, data: any) => this.client.put(`/ticket-settings/${id}`, data);
  deleteTicketSetting = (id: string) => this.client.delete(`/ticket-settings/${id}`);
  getTags = (params?: any) => this.client.get('/tags', { params });
  createTag = (data: any) => this.client.post('/tags', data);
  updateTag = (id: string, data: any) => this.client.put(`/tags/${id}`, data);
  deleteTag = (id: string) => this.client.delete(`/tags/${id}`);
  getRootCauses = (params?: any) => this.client.get('/root-causes', { params });
  createRootCause = (data: any) => this.client.post('/root-causes', data);
  updateRootCause = (id: string, data: any) => this.client.put(`/root-causes/${id}`, data);
  deleteRootCause = (id: string) => this.client.delete(`/root-causes/${id}`);

  getCustomers = (params?: any) => this.client.get('/customers', { params });
  getCustomer = (id: string) => this.client.get(`/customers/${id}`);
  createCustomer = (data: any) => this.client.post('/customers', data);
  updateCustomer = (id: string, data: any) => this.client.put(`/customers/${id}`, data);
  deleteCustomer = (id: string) => this.client.delete(`/customers/${id}`);
  changeCustomerNetwork = (id: string, networkId: string | null) => this.client.patch(`/customers/${id}/network`, { networkId });
  getContacts = (clientId: string) => this.client.get(`/customers/${clientId}/contacts`);
  getContactById = (contactId: string) => this.client.get(`/customers/contact/${contactId}`);
  createContact = (clientId: string, data: any) => this.client.post(`/customers/${clientId}/contacts`, data);
  updateContact = (clientId: string, contactId: string, data: any) => this.client.put(`/customers/${clientId}/contacts/${contactId}`, data);
  removeContact = (clientId: string, contactId: string) => this.client.delete(`/customers/${clientId}/contacts/${contactId}`);

  getContracts = () => this.client.get('/contracts');
  getContract = (id: string) => this.client.get(`/contracts/${id}`);
  createContract = (data: any) => this.client.post('/contracts', data);
  updateContract = (id: string, data: any) => this.client.put(`/contracts/${id}`, data);
  deleteContract = (id: string) => this.client.delete(`/contracts/${id}`);
  contractConsumption = (id: string) => this.client.get(`/contracts/${id}/consumption`);
  expiringContracts = () => this.client.get('/contracts/expiring');

  getDevices = (params?: any) => this.client.get('/devices', { params });
  getDevice = (id: string) => this.client.get(`/devices/${id}`);
  createDevice = (data: any) => this.client.post('/devices', data);
  updateDevice = (id: string, data: any) => this.client.put(`/devices/${id}`, data);
  deviceSummary = () => this.client.get('/devices/summary');
  deviceEvents = (id: string) => this.client.get(`/devices/${id}/events`);

  getTeam = () => this.client.get('/team');
  getTeamMember = (id: string) => this.client.get(`/team/${id}`);
  createTeamMember = (data: any) => this.client.post('/team', data);
  updateTeamMember = (id: string, data: any) => this.client.put(`/team/${id}`, data);
  removeTeamMember = (id: string) => this.client.delete(`/team/${id}`);

  // Distribuição de chamados — departamentos do agente
  getAgentDepartments = (userId: string) => this.client.get(`/agents/${userId}/departments`);
  setAgentDepartments = (userId: string, departments: string[]) =>
    this.client.put(`/agents/${userId}/departments`, { departments });

  searchKb = (q: string) => this.client.get(`/knowledge/search?q=${encodeURIComponent(q)}`);
  getKbCategories = () => this.client.get('/knowledge/categories');
  getKbArticles = (params?: any) => this.client.get('/knowledge', { params });
  getKbArticle = (id: string) => this.client.get(`/knowledge/${id}`);
  createKbArticle = (data: any) => this.client.post('/knowledge', data);
  updateKbArticle = (id: string, data: any) => this.client.put(`/knowledge/${id}`, data);

  getNetworks = (search?: string) => this.client.get('/networks', { params: { search } });
  getNetwork = (id: string) => this.client.get(`/networks/${id}`);
  createNetwork = (data: any) => this.client.post('/networks', data);
  updateNetwork = (id: string, data: any) => this.client.put(`/networks/${id}`, data);
  deleteNetwork = (id: string) => this.client.delete(`/networks/${id}`);
  getSettings      = ()             => this.client.get('/settings');
  updateSettings   = (data: any)    => this.client.put('/settings', data);
  testSmtp         = ()             => this.client.post('/settings/test-smtp');
  logout           = ()             => this.client.post('/auth/logout');
  clockIn          = ()             => this.client.post('/attendance/clock-in');
  clockOut         = (data?: any)   => this.client.post('/attendance/clock-out', data || {});
  attendanceStatus = ()             => this.client.get('/attendance/status');
  attendanceToday  = ()             => this.client.get('/attendance/today');
  getAttendance    = (params?: any) => this.client.get('/attendance', { params });

  // Routing Rules
  getRoutingRules = () => this.client.get('/routing-rules');
  createRoutingRule = (data: any) => this.client.post('/routing-rules', data);
  updateRoutingRule = (id: string, data: any) => this.client.put(`/routing-rules/${id}`, data);
  deleteRoutingRule = (id: string) => this.client.delete(`/routing-rules/${id}`);

  // Admin / Danger zone
  resetTestData = () => this.client.delete('/settings/reset-test-data');

  // Chatbot
  getChatbotConfig = () => this.client.get('/chatbot/config');
  updateChatbotConfig = (data: any) => this.client.patch('/chatbot/config', data);
  updateChatbotMenu = (data: any) => this.client.put('/chatbot/menu', data);
  getChatbotStats = () => this.client.get('/chatbot/stats');

  // Webhooks
  getWebhooks = () => this.client.get('/webhooks-config');
  createWebhook = (data: any) => this.client.post('/webhooks-config', data);
  updateWebhook = (id: string, data: any) => this.client.put(`/webhooks-config/${id}`, data);
  deleteWebhook = (id: string) => this.client.delete(`/webhooks-config/${id}`);

  // API Keys
  getApiKeys = () => this.client.get('/api-keys');
  createApiKey = (data: any) => this.client.post('/api-keys', data);
  revokeApiKey = (id: string) => this.client.delete(`/api-keys/${id}/revoke`);
  deleteApiKey = (id: string) => this.client.delete(`/api-keys/${id}`);

  // Trend
  ticketTrend = (days = 30) => this.client.get(`/dashboard/ticket-trend?days=${days}`);

  // Team Chat
  getChatChannels = () => this.client.get('/team-chat/channels');
  getChatMessages = (channel = 'general', limit = 50) => this.client.get(`/team-chat/messages?channel=${channel}&limit=${limit}`);
  postChatMessage = (data: { content: string; channel?: string; replyTo?: string }) => this.client.post('/team-chat/messages', data);

  // Presence (status em tempo real dos agentes)
  getPresence = () => this.client.get('/presence');

  // Internal Chat (individual 1-a-1)
  getInternalChatUsers = () => this.client.get('/internal-chat/users');
  getInternalChatConversations = () => this.client.get('/internal-chat/conversations');
  getInternalChatMessages = (recipientId: string) => this.client.get(`/internal-chat/messages/${recipientId}`);
  getInternalChatOnline = () => this.client.get('/internal-chat/online');
  postInternalChatMessage = (data: { recipientId: string; content: string }) => this.client.post('/internal-chat/messages', data);

  // Public Knowledge Base
  getPublicKnowledge = (tenantId: string, search?: string) => this.client.get('/public/knowledge', { params: { tenantId, search } });
  getPublicKbCategories = (tenantId: string) => this.client.get('/public/knowledge/categories', { params: { tenantId } });

  // Gestão de Perfis (Roles & Permissions)
  getAllPermissions = () => this.client.get('/permissions');
  getRoles = () => this.client.get('/permissions/roles');
  getRole = (id: string) => this.client.get(`/permissions/roles/${id}`);
  createRole = (data: { slug: string; name: string; description?: string; permissions?: string[] }) =>
    this.client.post('/permissions/roles', data);
  updateRole = (id: string, data: { name?: string; description?: string }) =>
    this.client.put(`/permissions/roles/${id}`, data);
  setRolePermissions = (id: string, permissions: string[]) =>
    this.client.put(`/permissions/roles/${id}/permissions`, { permissions });
  deleteRole = (id: string) => this.client.delete(`/permissions/roles/${id}`);

  // ── Contact Validation (Prompt 2/3) ──────────────────────────────────────
  /** GET /attendance/:ticketId/contact-validation */
  getContactValidation = (ticketId: string) =>
    this.client.get(`/attendance/${ticketId}/contact-validation`);
  /** POST /attendance/:ticketId/select-customer — confirma cliente já existente */
  selectCustomer = (ticketId: string, clientId: string) =>
    this.client.post(`/attendance/${ticketId}/select-customer`, { clientId });
  /** POST /attendance/:ticketId/link-contact — cria pivot N:N + atualiza ticket */
  linkContact = (ticketId: string, clientId: string) =>
    this.client.post(`/attendance/${ticketId}/link-contact`, { clientId });
  /** POST /attendance/:ticketId/skip-link — pula vinculação */
  skipLink = (ticketId: string) =>
    this.client.post(`/attendance/${ticketId}/skip-link`);
  /** GET /customers/search?q= — busca clientes por nome ou CNPJ */
  searchCustomers = (q: string) =>
    this.client.get('/customers/search', { params: { q } });

  // ── Admin / SaaS ────────────────────────────────────────────────────────
  adminListTenants = (params?: { search?: string; status?: string }) =>
    this.client.get('/admin/tenants', { params });

  adminGetTenant = (id: string) =>
    this.client.get(`/admin/tenants/${id}`);

  adminCreateTenant = (data: {
    name: string;
    slug: string;
    email?: string;
    phone?: string;
    planSlug?: string;
    adminName: string;
    adminEmail: string;
    adminPassword?: string;
  }) => this.client.post('/admin/tenants', data);

  adminUpdateTenant = (id: string, data: any) =>
    this.client.put(`/tenants/${id}`, data);
}

export const api = new ApiClient();
