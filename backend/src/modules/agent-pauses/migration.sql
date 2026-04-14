-- =============================================================================
-- Migration: Agent Pause Requests com Aprovação (recurso de pausas)
-- Aplicar manualmente em produção (DB_SYNCHRONIZE=false)
-- Em desenvolvimento (DB_SYNCHRONIZE=true) as tabelas são criadas automaticamente
-- =============================================================================

-- ── Tabela: pause_reasons ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pause_reasons (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           VARCHAR       NOT NULL,
  name                VARCHAR(100)  NOT NULL,
  description         VARCHAR(255),
  requires_approval   BOOLEAN       NOT NULL DEFAULT TRUE,
  active              BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order          INTEGER       NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_pause_reason_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pause_reasons_tenant ON pause_reasons (tenant_id);

-- ── Tabela: agent_pause_requests ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_pause_requests (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 VARCHAR       NOT NULL,

  -- Agente
  agent_id                  VARCHAR       NOT NULL,
  agent_name                VARCHAR,

  -- Motivo
  reason_id                 UUID          NOT NULL REFERENCES pause_reasons(id),
  reason_name               VARCHAR       NOT NULL,

  -- Observações
  agent_observation         TEXT,
  reviewer_observation      TEXT,

  -- Status do workflow
  -- Valores: pending | approved | rejected | active | finished | cancelled
  status                    VARCHAR(20)   NOT NULL DEFAULT 'pending',

  -- Timestamps do workflow
  requested_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  reviewed_at               TIMESTAMPTZ,
  reviewed_by               VARCHAR,
  reviewer_name             VARCHAR,
  started_at                TIMESTAMPTZ,
  ended_at                  TIMESTAMPTZ,
  duration_seconds          INTEGER,

  -- Auditoria: status de presença antes da pausa (para restauração)
  previous_presence_status  VARCHAR(20),

  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pause_req_tenant_agent
  ON agent_pause_requests (tenant_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_pause_req_status
  ON agent_pause_requests (tenant_id, status);

-- Índice parcial: impede dois registros pending/active para o mesmo agente
-- (complementa a validação no service — defesa em profundidade)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pause_req_agent_active
  ON agent_pause_requests (tenant_id, agent_id)
  WHERE status IN ('pending', 'active');

-- =============================================================================
-- Rollback (executar em ordem inversa para desfazer):
-- DROP INDEX IF EXISTS uq_pause_req_agent_active;
-- DROP INDEX IF EXISTS idx_pause_req_status;
-- DROP INDEX IF EXISTS idx_pause_req_tenant_agent;
-- DROP TABLE IF EXISTS agent_pause_requests;
-- DROP INDEX IF EXISTS idx_pause_reasons_tenant;
-- DROP TABLE IF EXISTS pause_reasons;
-- =============================================================================
