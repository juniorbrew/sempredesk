-- ============================================================
-- 027: Backfill idempotente tickets.priority_id (M1 migração)
-- Alinha priority_id ao slug em tenant_priorities quando ainda NULL.
-- Seguro multi-tenant: só faz match tenant_id + slug = tickets.priority::text.
-- Não remove coluna legada tickets.priority.
-- Pré-requisito: 023_tenant_priorities.sql, 026_tickets_priority_id.sql
-- ============================================================

UPDATE tickets t
SET priority_id = tp.id
FROM tenant_priorities tp
WHERE t.priority_id IS NULL
  AND tp.tenant_id = t.tenant_id
  AND tp.slug = t.priority::text;

-- Opcional: relatório pós-execução (comentar se executar só o UPDATE)
-- SELECT COUNT(*) AS still_null FROM tickets WHERE priority_id IS NULL;
