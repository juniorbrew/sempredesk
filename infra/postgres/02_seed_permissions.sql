-- ================================================================
-- Perfis e permissões — alinhado a permissions.service.ts (seed).
-- Roda após init.sql em bancos novos (docker-entrypoint-initdb.d).
-- Idempotente: ON CONFLICT DO NOTHING.
-- ================================================================

INSERT INTO permissions (code, name, module)
SELECT v.code, replace(v.code, '.', ' '), split_part(v.code, '.', 1)
FROM (VALUES
  ('dashboard.view'),
  ('ticket.view'),
  ('ticket.create'),
  ('ticket.edit'),
  ('ticket.edit_content'),
  ('ticket.reply'),
  ('ticket.transfer'),
  ('ticket.close'),
  ('ticket.reopen'),
  ('customer.view'),
  ('customer.create'),
  ('customer.edit'),
  ('agent.view'),
  ('agent.create'),
  ('agent.edit'),
  ('agent.delete'),
  ('settings.manage'),
  ('reports.view'),
  ('knowledge.view'),
  ('knowledge.edit'),
  ('contracts.view'),
  ('contracts.edit'),
  ('networks.view'),
  ('networks.edit'),
  ('devices.view'),
  ('devices.edit'),
  ('alerts.view'),
  ('alerts.manage'),
  ('chat.view'),
  ('chat.view_agents'),
  ('chat.view_status'),
  ('attendance.view'),
  ('ticket.view_all'),
  ('attendance.view_all')
) AS v(code)
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (slug, name) VALUES
  ('super_admin', 'Super Administrador'),
  ('admin', 'Administrador'),
  ('manager', 'Supervisor'),
  ('technician', 'Agente'),
  ('viewer', 'Visualizador')
ON CONFLICT (slug) DO NOTHING;

-- super_admin + admin: todas as permissões
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'dashboard.view', 'ticket.view', 'ticket.create', 'ticket.edit', 'ticket.edit_content',
  'ticket.reply', 'ticket.transfer', 'ticket.close', 'ticket.reopen', 'customer.view',
  'customer.create', 'customer.edit', 'agent.view', 'reports.view', 'knowledge.view',
  'knowledge.edit', 'contracts.view', 'networks.view', 'networks.edit', 'devices.view',
  'devices.edit', 'alerts.view', 'chat.view', 'chat.view_agents', 'chat.view_status',
  'attendance.view', 'ticket.view_all', 'attendance.view_all'
)
WHERE r.slug = 'manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- technician
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'dashboard.view', 'ticket.view', 'ticket.create', 'ticket.edit', 'ticket.edit_content',
  'ticket.reply', 'ticket.close', 'customer.view', 'knowledge.view', 'contracts.view',
  'devices.view', 'devices.edit', 'alerts.view', 'chat.view', 'chat.view_agents',
  'chat.view_status', 'attendance.view'
)
WHERE r.slug = 'technician'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- viewer
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'dashboard.view', 'ticket.view', 'customer.view', 'agent.view', 'reports.view',
  'knowledge.view', 'contracts.view', 'devices.view', 'alerts.view', 'attendance.view'
)
WHERE r.slug = 'viewer'
ON CONFLICT (role_id, permission_id) DO NOTHING;
