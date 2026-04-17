-- ============================================================
-- Phase 2: adiciona department_id como chave canônica estável em
-- agent_departments, distribution_queues e routing_rules.
-- Os campos name string são mantidos para compatibilidade e display.
-- ============================================================

-- 1. agent_departments.department_id
ALTER TABLE agent_departments
  ADD COLUMN IF NOT EXISTS department_id UUID
    REFERENCES ticket_settings(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_dept_by_id
  ON agent_departments(tenant_id, user_id, department_id)
  WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_departments_dept_id
  ON agent_departments(department_id) WHERE department_id IS NOT NULL;

-- 2. distribution_queues.department_id
ALTER TABLE distribution_queues
  ADD COLUMN IF NOT EXISTS department_id UUID
    REFERENCES ticket_settings(id) ON DELETE SET NULL;

-- Índice único para queues com ID (named depts); o índice de nome continua para __global__
CREATE UNIQUE INDEX IF NOT EXISTS uq_dist_queue_by_id
  ON distribution_queues(tenant_id, department_id)
  WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dist_queues_dept_id
  ON distribution_queues(department_id) WHERE department_id IS NOT NULL;

-- 3. routing_rules.cond_department_id
ALTER TABLE routing_rules
  ADD COLUMN IF NOT EXISTS cond_department_id UUID
    REFERENCES ticket_settings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_routing_rules_dept_id
  ON routing_rules(cond_department_id) WHERE cond_department_id IS NOT NULL;

-- ── Backfill: agent_departments ──────────────────────────────────────────────
UPDATE agent_departments ad
SET    department_id = ts.id
FROM   ticket_settings ts
WHERE  ts.tenant_id::text = ad.tenant_id::text
  AND  ts.type            = 'department'
  AND  LOWER(TRIM(ts.name)) = LOWER(TRIM(ad.department_name))
  AND  ad.department_id IS NULL;

-- ── Backfill: distribution_queues (apenas departamentos nomeados, não __global__) ──
UPDATE distribution_queues dq
SET    department_id = ts.id
FROM   ticket_settings ts
WHERE  ts.tenant_id::text = dq.tenant_id::text
  AND  ts.type            = 'department'
  AND  LOWER(TRIM(ts.name)) = LOWER(TRIM(dq.department_name))
  AND  dq.department_name  != '__global__'
  AND  dq.department_id IS NULL;

-- ── Backfill: routing_rules ──────────────────────────────────────────────────
UPDATE routing_rules rr
SET    cond_department_id = ts.id
FROM   ticket_settings ts
WHERE  ts.tenant_id::text  = rr.tenant_id::text
  AND  ts.type             = 'department'
  AND  LOWER(TRIM(ts.name)) = LOWER(TRIM(rr.cond_department))
  AND  rr.cond_department  IS NOT NULL
  AND  rr.cond_department_id IS NULL;
