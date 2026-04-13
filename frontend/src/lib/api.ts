import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { TENANT_LICENSE_BLOCKED_CODE } from './api-errors';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
  : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000') + '/api/v1';

/**
 * Mesma instância que `AxiosInstance`, tipada como Promise do payload já desembrulhado
 * pelo interceptor de sucesso (`res.data?.data ?? res.data`).
 */
type UnwrappedHttpClient = {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
  request<T = unknown>(config: AxiosRequestConfig): Promise<T>;
};

class ApiClient {
  private client: AxiosInstance;
  private readonly http: UnwrappedHttpClient;

  constructor() {
    this.client = axios.create({ baseURL: BASE_URL });
    this.http = this.client as unknown as UnwrappedHttpClient;

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
              return this.http.request(err.config);
            } catch {
              localStorage.clear();
              window.location.href = '/auth/login';
            }
          }
        }
        if (err.response?.status === 403 && typeof window !== 'undefined') {
          const raw = err.response?.data?.error;
          const code = typeof raw === 'object' && raw && 'code' in raw ? (raw as { code?: string }).code : null;
          if (code === TENANT_LICENSE_BLOCKED_CODE) {
            const path = window.location.pathname || '';
            if (!path.startsWith('/license-blocked')) {
              const errObj = typeof raw === 'object' && raw ? (raw as { message?: string; reasonKey?: string }) : null;
              const msg = errObj?.message != null ? String(errObj.message) : '';
              const rk = errObj?.reasonKey != null ? String(errObj.reasonKey) : '';
              const q = new URLSearchParams();
              if (msg) q.set('reason', msg);
              if (rk) q.set('rk', rk);
              if (path.startsWith('/portal')) q.set('from', 'portal');
              else q.set('from', 'staff');
              window.location.replace(`/license-blocked?${q.toString()}`);
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

  login = (email: string, password: string) => this.http.post('/auth/login', { email, password });
  me = () => this.http.get('/auth/me');
  getMyPermissions = () => this.http.get('/auth/permissions');
  refresh = (refreshToken: string) => this.http.post('/auth/refresh', { refreshToken });

  dashboardSummary = () => this.http.get('/dashboard/summary');
  dashboardByPriority = () => this.http.get('/dashboard/tickets-by-priority');
  dashboardTrend = (days = 7) => this.http.get(`/dashboard/ticket-trend?days=${days}`);
  slaReport = () => this.http.get('/dashboard/sla-report');

  // SLA Policies
  getSlaPolicies = () => this.http.get('/sla-policies');
  createSlaPolicy = (data: any) => this.http.post('/sla-policies', data);
  updateSlaPolicy = (id: string, data: any) => this.http.put(`/sla-policies/${id}`, data);
  deleteSlaPolicy = (id: string) => this.http.delete(`/sla-policies/${id}`);

  /**
   * Prioridades ativas para criação de ticket; em edição, passe `currentPriorityId` para incluir
   * a prioridade atual mesmo se estiver inativa no cadastro.
   */
  getTenantPrioritiesForTickets = (currentPriorityId?: string | null) =>
    this.http.get('/tenant-priorities/for-tickets', {
      params: currentPriorityId ? { currentPriorityId } : {},
    });
  getTenantPriorities = () => this.http.get('/tenant-priorities');
  getTenantPriority = (id: string) => this.http.get(`/tenant-priorities/${id}`);
  createTenantPriority = (data: any) => this.http.post('/tenant-priorities', data);
  updateTenantPriority = (id: string, data: any) => this.http.put(`/tenant-priorities/${id}`, data);
  setTenantPriorityActive = (id: string, active: boolean) =>
    this.http.patch(`/tenant-priorities/${id}/active`, { active });

  getTickets = (params?: any) => this.http.get('/tickets', { params });
  getTicket = (id: string) => this.http.get(`/tickets/${id}`);
  getTicketConversations = (params?: { origin?: 'portal' | 'whatsapp'; status?: string; perPage?: number }) =>
    this.http.get('/tickets/conversations', { params });
  getTicketByNumber = (number: string, clientId: string) =>
    this.http.get(`/tickets/by-number/${encodeURIComponent(number)}`, { params: { clientId } });
  createTicket = (data: any) => this.http.post('/tickets', data);
  updateTicket = (id: string, data: any) => this.http.put(`/tickets/${id}`, data);
  ticketStats = () => this.http.get('/tickets/stats');
  getMessages = (id: string, includeInternal = true) => this.http.get(`/tickets/${id}/messages`, { params: { includeInternal, limit: 200 } });
  addMessage = (id: string, data: any) => this.http.post(`/tickets/${id}/messages`, data);
  /** Resposta pública com ficheiro (multipart). Domínio ticket — não usa conversa. */
  addTicketPublicReplyAttachment = (ticketId: string, data: { content?: string; file: File }) => {
    const fd = new FormData();
    const c = (data.content ?? '').trim();
    if (c) fd.append('content', c);
    fd.append('file', data.file);
    return this.http.post(`/tickets/${ticketId}/messages/attachment`, fd);
  };
  /** Blob do anexo gravado em ticket_reply_attachments. */
  getTicketReplyAttachmentBlob = (ticketId: string, attachmentId: string) =>
    this.http.get<Blob>(`/tickets/${ticketId}/reply-attachments/${attachmentId}/media`, { responseType: 'blob' });
  sendWhatsappFromTicket = (ticketId: string, text: string, replyToId?: string | null) =>
    this.http.post('/webhooks/whatsapp/send-from-ticket', { ticketId, text, replyToId: replyToId ?? undefined });
  /** Ticket WhatsApp sem conversa: multipart com `file` (mesmos tipos do chat); envia WA e grava em ticket_messages. */
  sendWhatsappMediaFromTicket = (
    ticketId: string,
    data: { file: File; content?: string; replyToId?: string | null },
  ) => {
    const fd = new FormData();
    const c = (data.content ?? '').trim();
    if (c) fd.append('content', c);
    if (data.replyToId) fd.append('replyToId', data.replyToId);
    fd.append('file', data.file);
    return this.http.post(`/webhooks/whatsapp/send-media-from-ticket/${ticketId}`, fd);
  };
  checkWhatsappNumber = (phone: string) =>
    this.http.post('/webhooks/whatsapp/check-number', { phone });
  /** GET /customers/search?q= — busca clientes por nome ou CNPJ */
  searchCustomers = (q: string) => this.http.get('/customers/search', { params: { q } });
  getWhatsappTemplates = () => this.http.get('/webhooks/whatsapp/templates');
  startOutboundConversation = (data: { phone?: string; contactId?: string; clientId?: string; subject?: string; firstMessage?: string; templateName?: string; templateLanguage?: string; templateParams?: string[] }) =>
    this.http.post('/webhooks/whatsapp/start-outbound', data);

  getConversations = (params?: { channel?: string; hasTicket?: string; status?: string }) =>
    this.http.get('/conversations', { params });
  getConversationsActiveCount = () => this.http.get('/conversations/active-count');
  /** Tickets em aberto (open / in_progress / waiting_client) atribuídos ao agente logado no tenant atual */
  getMyOpenAssignedTicketsCount = () => this.http.get('/tickets/me/open-assigned-count');
  getConversation = (id: string) => this.http.get(`/conversations/${id}`);
  getConversationMessages = (id: string, params?: { limit?: number; before?: string }) =>
    this.http.get(`/conversations/${id}/messages`, { params });
  /** Texto JSON ou multipart com campo opcional `file` (imagem/áudio) e replyToId (reply). */
  addConversationMessage = (id: string, data: { content?: string; file?: File | null; replyToId?: string | null }) => {
    if (data.file) {
      const fd = new FormData();
      const c = (data.content ?? '').trim();
      if (c) fd.append('content', c);
      if (data.replyToId) fd.append('replyToId', data.replyToId);
      fd.append('file', data.file);
      return this.http.post(`/conversations/${id}/messages`, fd);
    }
    return this.http.post(`/conversations/${id}/messages`, { content: data.content ?? '', replyToId: data.replyToId ?? undefined });
  };
  /** Blob autenticado (imagem ou áudio) para mensagem de conversa. */
  getConversationMessageMediaBlob = (messageId: string) =>
    this.http.get<Blob>(`/conversations/messages/${messageId}/media`, { responseType: 'blob' });
  updateConversationTags = (id: string, tags: string[]) => this.http.put(`/conversations/${id}/tags`, { tags });
  getConversationsByClient = (clientId: string, channel?: string) =>
    this.http.get(`/conversations/by-client/${clientId}`, { params: channel ? { channel } : {} });
  startAgentConversation = (data: { clientId: string; contactId: string; channel: string }) =>
    this.http.post('/conversations/start-by-agent', data);
  createTicketForConversation = (conversationId: string, data?: { subject?: string }) =>
    this.http.post(`/conversations/${conversationId}/create-ticket`, data || {});
  startAttendance = (conversationId: string) =>
    this.http.post(`/conversations/${conversationId}/start-attendance`, {});
  linkTicketToConversation = (conversationId: string, ticketId: string) =>
    this.http.post(`/conversations/${conversationId}/link-ticket`, { ticketId });
  closeConversation = (id: string, opts?: { keepTicketOpen?: boolean; solution?: string; rootCause?: string; timeSpentMin?: number; internalNote?: string; complexity?: number }) =>
    this.http.post(`/conversations/${id}/close`, opts || {});
  markConversationRead = (id: string) => this.http.post(`/conversations/${id}/mark-read`);
  assignTicket = (id: string, techId: string) => this.http.post(`/tickets/${id}/assign`, { techId });
  updateTicketContent = (id: string, data: { subject: string; description?: string }) => this.http.put(`/tickets/${id}/content`, data);
  getAttendanceQueueStats = () => this.http.get('/attendance/queue-stats');
  resolveTicket = (id: string, data?: any) => this.http.post(`/tickets/${id}/resolve`, data || {});
  closeTicket = (id: string) => this.http.post(`/tickets/${id}/close`);
  cancelTicket = (id: string, data?: any) => this.http.post(`/tickets/${id}/cancel`, data || {});
  escalateTicket = (id: string) => this.http.post(`/tickets/${id}/escalate`);
  submitSatisfaction = (id: string, score: 'approved' | 'rejected') => this.http.post(`/tickets/${id}/satisfaction`, { score });

  getTicketSettings = (params?: any) => this.http.get('/ticket-settings', { params });
  getTicketSettingsTree = () => this.http.get('/ticket-settings/tree');
  createTicketSetting = (data: any) => this.http.post('/ticket-settings', data);
  updateTicketSetting = (id: string, data: any) => this.http.put(`/ticket-settings/${id}`, data);
  deleteTicketSetting = (id: string) => this.http.delete(`/ticket-settings/${id}`);
  getTags = (params?: any) => this.http.get('/tags', { params });
  createTag = (data: any) => this.http.post('/tags', data);
  updateTag = (id: string, data: any) => this.http.put(`/tags/${id}`, data);
  deleteTag = (id: string) => this.http.delete(`/tags/${id}`);
  getRootCauses = (params?: any) => this.http.get('/root-causes', { params });
  createRootCause = (data: any) => this.http.post('/root-causes', data);
  updateRootCause = (id: string, data: any) => this.http.put(`/root-causes/${id}`, data);
  deleteRootCause = (id: string) => this.http.delete(`/root-causes/${id}`);

  getCustomers = (params?: any) => this.http.get('/customers', { params });
  getCustomer = (id: string) => this.http.get(`/customers/${id}`);
  createCustomer = (data: any) => this.http.post('/customers', data);
  updateCustomer = (id: string, data: any) => this.http.put(`/customers/${id}`, data);
  deleteCustomer = (id: string) => this.http.delete(`/customers/${id}`);
  changeCustomerNetwork = (id: string, networkId: string | null) => this.http.patch(`/customers/${id}/network`, { networkId });
  getContacts = (clientId: string, includeArchived = false) =>
    this.http.get(`/customers/${clientId}/contacts`, {
      params: includeArchived ? { includeArchived: true } : {},
    });
  getContactById = (contactId: string) => this.http.get(`/customers/contact/${contactId}`);
  createContact = (clientId: string, data: any) => this.http.post(`/customers/${clientId}/contacts`, data);
  updateContact = (clientId: string, contactId: string, data: any) => this.http.put(`/customers/${clientId}/contacts/${contactId}`, data);
  removeContact = (clientId: string, contactId: string) => this.http.delete(`/customers/${clientId}/contacts/${contactId}`);
  /** Etapa 10 — arquivamento (requer FEATURE_CONTACT_ARCHIVE no backend) */
  archiveCustomerContact = (clientId: string, contactId: string) =>
    this.http.patch(`/customers/${clientId}/contacts/${contactId}/archive`, {});
  unarchiveCustomerContact = (clientId: string, contactId: string) =>
    this.http.patch(`/customers/${clientId}/contacts/${contactId}/unarchive`, {});

  /** Métricas/flag Etapa 9 — super_admin; em 403 use getMonitoringHealth como fallback */
  getContactArchiveRollout = () => this.http.get('/monitoring/contact-archive-rollout');
  getMonitoringHealth = () => this.http.get('/monitoring/health');

  getContracts = () => this.http.get('/contracts');
  getContract = (id: string) => this.http.get(`/contracts/${id}`);
  createContract = (data: any) => this.http.post('/contracts', data);
  updateContract = (id: string, data: any) => this.http.put(`/contracts/${id}`, data);
  deleteContract = (id: string) => this.http.delete(`/contracts/${id}`);
  contractConsumption = (id: string) => this.http.get(`/contracts/${id}/consumption`);
  expiringContracts = () => this.http.get('/contracts/expiring');

  getDevices = (params?: any) => this.http.get('/devices', { params });
  getDevice = (id: string) => this.http.get(`/devices/${id}`);
  createDevice = (data: any) => this.http.post('/devices', data);
  updateDevice = (id: string, data: any) => this.http.put(`/devices/${id}`, data);
  deviceSummary = () => this.http.get('/devices/summary');
  deviceEvents = (id: string) => this.http.get(`/devices/${id}/events`);

  getTeam = () => this.http.get('/team');
  getTeamMember = (id: string) => this.http.get(`/team/${id}`);
  createTeamMember = (data: any) => this.http.post('/team', data);
  updateTeamMember = (id: string, data: any) => this.http.put(`/team/${id}`, data);
  removeTeamMember = (id: string) => this.http.delete(`/team/${id}`);

  // Distribuição de chamados — departamentos do agente
  getAgentDepartments = (userId: string) => this.http.get(`/agents/${userId}/departments`);
  setAgentDepartments = (userId: string, departments: string[]) =>
    this.http.put(`/agents/${userId}/departments`, { departments });

  searchKb = (q: string) => this.http.get(`/knowledge/search?q=${encodeURIComponent(q)}`);
  getKbCategories = () => this.http.get('/knowledge/categories');
  getKbArticles = (params?: any) => this.http.get('/knowledge', { params });
  getKbArticle = (id: string) => this.http.get(`/knowledge/${id}`);
  createKbArticle = (data: any) => this.http.post('/knowledge', data);
  updateKbArticle = (id: string, data: any) => this.http.put(`/knowledge/${id}`, data);

  getNetworks = (search?: string) => this.http.get('/networks', { params: { search } });
  getNetwork = (id: string) => this.http.get(`/networks/${id}`);
  createNetwork = (data: any) => this.http.post('/networks', data);
  updateNetwork = (id: string, data: any) => this.http.put(`/networks/${id}`, data);
  deleteNetwork = (id: string) => this.http.delete(`/networks/${id}`);
  getSettings      = ()             => this.http.get('/settings');
  updateSettings   = (data: any)    => this.http.put('/settings', data);
  testSmtp         = ()             => this.http.post('/settings/test-smtp');
  logout           = ()             => this.http.post('/auth/logout');
  clockIn          = ()             => this.http.post('/attendance/clock-in');
  clockOut         = (data?: any)   => this.http.post('/attendance/clock-out', data || {});
  attendanceStatus = ()             => this.http.get('/attendance/status');
  attendanceToday  = ()             => this.http.get('/attendance/today');
  getAttendance    = (params?: any) => this.http.get('/attendance', { params });

  // Routing Rules
  getRoutingRules = () => this.http.get('/routing-rules');
  createRoutingRule = (data: any) => this.http.post('/routing-rules', data);
  updateRoutingRule = (id: string, data: any) => this.http.put(`/routing-rules/${id}`, data);
  deleteRoutingRule = (id: string) => this.http.delete(`/routing-rules/${id}`);

  // Admin / Danger zone
  resetTestData = () => this.http.delete('/settings/reset-test-data');

  // Chatbot
  getChatbotConfig = () => this.http.get('/chatbot/config');
  updateChatbotConfig = (data: any) => this.http.patch('/chatbot/config', data);
  updateChatbotMenu = (data: any) => this.http.put('/chatbot/menu', data);
  getChatbotStats = () => this.http.get('/chatbot/stats');

  // Webhooks
  getWebhooks = () => this.http.get('/webhooks-config');
  createWebhook = (data: any) => this.http.post('/webhooks-config', data);
  updateWebhook = (id: string, data: any) => this.http.put(`/webhooks-config/${id}`, data);
  deleteWebhook = (id: string) => this.http.delete(`/webhooks-config/${id}`);

  // API Keys
  getApiKeys = () => this.http.get('/api-keys');
  createApiKey = (data: any) => this.http.post('/api-keys', data);
  revokeApiKey = (id: string) => this.http.delete(`/api-keys/${id}/revoke`);
  deleteApiKey = (id: string) => this.http.delete(`/api-keys/${id}`);

  // Trend
  ticketTrend = (days = 30) => this.http.get(`/dashboard/ticket-trend?days=${days}`);

  // Team Chat
  getChatChannels = () => this.http.get('/team-chat/channels');
  getChatMessages = (channel = 'general', limit = 50) => this.http.get(`/team-chat/messages?channel=${channel}&limit=${limit}`);
  postChatMessage = (data: { content: string; channel?: string; replyTo?: string }) => this.http.post('/team-chat/messages', data);

  // Presence (status em tempo real dos agentes)
  getPresence = () => this.http.get('/presence');

  // Internal Chat (individual 1-a-1)
  getInternalChatUsers = () => this.http.get('/internal-chat/users');
  getInternalChatConversations = () => this.http.get('/internal-chat/conversations');
  getInternalChatMessages = (recipientId: string) => this.http.get(`/internal-chat/messages/${recipientId}`);
  getInternalChatOnline = () => this.http.get('/internal-chat/online');
  postInternalChatMessage = (data: { recipientId: string; content: string }) => this.http.post('/internal-chat/messages', data);

  // Public Knowledge Base
  getPublicKnowledge = (tenantId: string, search?: string) => this.http.get('/public/knowledge', { params: { tenantId, search } });
  getPublicKbCategories = (tenantId: string) => this.http.get('/public/knowledge/categories', { params: { tenantId } });

  // Gestão de Perfis (Roles & Permissions)
  getAllPermissions = () => this.http.get('/permissions');
  getRoles = () => this.http.get('/permissions/roles');
  getRole = (id: string) => this.http.get(`/permissions/roles/${id}`);
  createRole = (data: { slug: string; name: string; description?: string; permissions?: string[] }) =>
    this.http.post('/permissions/roles', data);
  updateRole = (id: string, data: { name?: string; description?: string }) =>
    this.http.put(`/permissions/roles/${id}`, data);
  setRolePermissions = (id: string, permissions: string[]) =>
    this.http.put(`/permissions/roles/${id}/permissions`, { permissions });
  deleteRole = (id: string) => this.http.delete(`/permissions/roles/${id}`);

  // ── Contact Validation (Prompt 2/3) ──────────────────────────────────────
  /** GET /attendance/:ticketId/contact-validation */
  getContactValidation = (ticketId: string) =>
    this.http.get(`/attendance/${ticketId}/contact-validation`);
  /** POST /attendance/:ticketId/select-customer — confirma cliente já existente */
  selectCustomer = (ticketId: string, clientId: string) =>
    this.http.post(`/attendance/${ticketId}/select-customer`, { clientId });
  /** POST /attendance/:ticketId/link-contact — cria pivot N:N + atualiza ticket */
  linkContact = (ticketId: string, clientId: string) =>
    this.http.post(`/attendance/${ticketId}/link-contact`, { clientId });
  /** POST /attendance/:ticketId/skip-link — pula vinculação */
  skipLink = (ticketId: string) =>
    this.http.post(`/attendance/${ticketId}/skip-link`);

  // ── Admin / SaaS ────────────────────────────────────────────────────────
  adminListTenants = (params?: { search?: string; status?: string }) =>
    this.http.get('/admin/tenants', { params });

  adminGetTenant = (id: string) =>
    this.http.get(`/admin/tenants/${id}`);

  adminCreateTenant = (data: {
    name: string;
    slug: string;
    cnpj?: string;
    email?: string;
    phone?: string;
    planSlug?: string;
    adminName: string;
    adminEmail: string;
    adminPassword?: string;
  }) => this.http.post('/admin/tenants', data);

  adminSuspendTenant = (id: string) => this.http.patch(`/admin/tenants/${id}/suspend`);
  adminReactivateTenant = (id: string) => this.http.patch(`/admin/tenants/${id}/reactivate`);
  adminRenewLicense = (id: string, periodDays = 30) =>
    this.http.post(`/admin/tenants/${id}/renew-license`, { periodDays });

  adminListAuditLogs = (params?: { limit?: number; offset?: number; action?: string; entityType?: string }) =>
    this.http.get('/admin/audit-logs', { params });
}

export const api = new ApiClient();
