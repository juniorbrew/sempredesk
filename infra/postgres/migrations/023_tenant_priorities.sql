-- ============================================================
-- 023: Prioridades cadastráveis por tenant (Fase 1)
-- Criado em: 2026-04-11
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant_priorities (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR      NOT NULL,
  name             VARCHAR(120) NOT NULL,
  slug             VARCHAR(64)  NOT NULL,
  color            VARCHAR(20)  NOT NULL DEFAULT '#64748B',
  sort_order       INTEGER      NOT NULL DEFAULT 0,
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  sla_policy_id    UUID         NULL REFERENCES sla_policies(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tenant_priorities_tenant_slug UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_priorities_tenant
  ON tenant_priorities (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_priorities_tenant_active
  ON tenant_priorities (tenant_id, active);

CREATE INDEX IF NOT EXISTS idx_tenant_priorities_sla_policy
  ON tenant_priorities (sla_policy_id)
  WHERE sla_policy_id IS NOT NULL;

-- Seed: 4 prioridades padrão por tenant (slug alinhado ao enum legado).
-- tenant_id alinhado a tenants.id::text e a users.tenant_id (UNION).
-- sla_policy_id preenchido quando existir política com o mesmo priority.
INSERT INTO tenant_priorities (tenant_id, name, slug, color, sort_order, active, sla_policy_id)
SELECT
  ti.tid,
  v.name,
  v.slug,
  v.color,
  v.sort_order,
  TRUE,
  sp.id
FROM (
  SELECT id::text AS tid FROM tenants
  UNION
  SELECT DISTINCT tenant_id AS tid FROM users WHERE tenant_id IS NOT NULL AND btrim(tenant_id) <> ''
) AS ti(tid)
CROSS JOIN (VALUES
  ('Baixa',      'low',      '#94A3B8', 1),
  ('Média',      'medium',   '#3B82F6', 2),
  ('Alta',       'high',     '#F97316', 3),
  ('Crítica',    'critical', '#EF4444', 4)
) AS v(name, slug, color, sort_order)
LEFT JOIN sla_policies sp
  ON sp.tenant_id = ti.tid AND sp.priority = v.slug
ON CONFLICT (tenant_id, slug) DO NOTHING;
