-- Migration 006: Ticket Assignment — Round-Robin

-- Pivot agente ↔ departamento
CREATE TABLE IF NOT EXISTS agent_departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       VARCHAR NOT NULL,
  user_id         VARCHAR NOT NULL,
  department_name VARCHAR NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_agent_dept UNIQUE (tenant_id, user_id, department_name)
);
CREATE INDEX IF NOT EXISTS agent_dept_user_idx ON agent_departments(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS agent_dept_name_idx ON agent_departments(tenant_id, department_name);

-- Fila round-robin por departamento
CREATE TABLE IF NOT EXISTS distribution_queues (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             VARCHAR NOT NULL,
  department_name       VARCHAR NOT NULL,
  last_assigned_user_id VARCHAR,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_dist_queue UNIQUE (tenant_id, department_name)
);
CREATE INDEX IF NOT EXISTS dist_queue_dept_idx ON distribution_queues(tenant_id, department_name);

-- Campo auto_assigned_at no ticket (nullable — compatível com dados existentes)
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS auto_assigned_at TIMESTAMPTZ;
