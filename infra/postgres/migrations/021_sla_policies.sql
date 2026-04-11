-- ============================================================
-- 021: SLA Policies + colunas SLA em conversations
-- Criado em: 2026-04-11
-- ============================================================

-- Tabela de políticas SLA por tenant
CREATE TABLE IF NOT EXISTS sla_policies (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                VARCHAR     NOT NULL,
  name                     VARCHAR(120) NOT NULL,
  priority                 VARCHAR(10)  NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  first_response_minutes   INTEGER      NOT NULL DEFAULT 60,
  resolution_minutes       INTEGER      NOT NULL DEFAULT 480,
  is_default               BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_policies_tenant
  ON sla_policies (tenant_id);

CREATE INDEX IF NOT EXISTS idx_sla_policies_tenant_priority
  ON sla_policies (tenant_id, priority);

-- Garante no máximo uma política default por tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_sla_policies_tenant_default
  ON sla_policies (tenant_id)
  WHERE is_default = TRUE;

-- Adiciona colunas SLA na tabela conversations (tudo nullable para retrocompatibilidade)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS sla_policy_id             UUID        REFERENCES sla_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sla_first_response_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_resolution_deadline     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_first_response_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_resolved_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_status                  VARCHAR(12);

CREATE INDEX IF NOT EXISTS idx_conversations_sla_status
  ON conversations (tenant_id, sla_status)
  WHERE sla_status IS NOT NULL;
