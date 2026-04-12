-- ============================================================
-- 026: tickets.priority_id (tenant_priorities) — Fase 4
-- Pré-requisito: 023_tenant_priorities.sql
-- Mantém coluna legada priority (enum) para transição.
-- ============================================================

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS priority_id UUID NULL
    REFERENCES tenant_priorities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_tenant_priority_id
  ON tickets (tenant_id, priority_id)
  WHERE priority_id IS NOT NULL;

-- Backfill: alinha priority_id ao slug da prioridade cadastrável quando existir.
UPDATE tickets t
SET priority_id = tp.id
FROM tenant_priorities tp
WHERE t.priority_id IS NULL
  AND tp.tenant_id = t.tenant_id
  AND tp.slug = t.priority::text;
