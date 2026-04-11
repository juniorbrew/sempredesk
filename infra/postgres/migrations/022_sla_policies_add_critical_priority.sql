-- ============================================================
-- 022: Permite prioridade critical em sla_policies
-- Criado em: 2026-04-11
-- ============================================================

ALTER TABLE sla_policies
  DROP CONSTRAINT IF EXISTS sla_policies_priority_check;

ALTER TABLE sla_policies
  ADD CONSTRAINT sla_policies_priority_check
  CHECK (priority IN ('low', 'medium', 'high', 'critical'));
