/**
 * Códigos de permissão do sistema.
 * Validação no backend; frontend usa apenas para esconder/mostrar UI.
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  TICKET_VIEW: 'ticket.view',
  TICKET_CREATE: 'ticket.create',
  TICKET_EDIT: 'ticket.edit',
  TICKET_EDIT_CONTENT: 'ticket.edit_content',
  TICKET_REPLY: 'ticket.reply',
  TICKET_TRANSFER: 'ticket.transfer',
  TICKET_CLOSE: 'ticket.close',
  TICKET_REOPEN: 'ticket.reopen',
  CUSTOMER_VIEW: 'customer.view',
  CUSTOMER_CREATE: 'customer.create',
  CUSTOMER_EDIT: 'customer.edit',
  AGENT_VIEW: 'agent.view',
  AGENT_CREATE: 'agent.create',
  AGENT_EDIT: 'agent.edit',
  AGENT_DELETE: 'agent.delete',
  SETTINGS_MANAGE: 'settings.manage',
  REPORTS_VIEW: 'reports.view',
  KNOWLEDGE_VIEW: 'knowledge.view',
  KNOWLEDGE_EDIT: 'knowledge.edit',
  CONTRACTS_VIEW: 'contracts.view',
  CONTRACTS_EDIT: 'contracts.edit',
  NETWORKS_VIEW: 'networks.view',
  NETWORKS_EDIT: 'networks.edit',
  DEVICES_VIEW: 'devices.view',
  DEVICES_EDIT: 'devices.edit',
  ALERTS_VIEW: 'alerts.view',
  ALERTS_MANAGE: 'alerts.manage',
  CHAT_VIEW: 'chat.view',
  CHAT_VIEW_AGENTS: 'chat.view_agents',
  CHAT_VIEW_STATUS: 'chat.view_status',
  ATTENDANCE_VIEW: 'attendance.view',
  TICKET_VIEW_ALL: 'ticket.view_all',
  ATTENDANCE_VIEW_ALL: 'attendance.view_all',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Mapeamento user.role -> role slug na tabela roles */
export const USER_ROLE_TO_SLUG: Record<string, string> = {
  super_admin: 'super_admin',
  admin: 'admin',
  manager: 'manager',
  technician: 'technician',
  viewer: 'viewer',
};
