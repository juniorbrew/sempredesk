-- ============================================================
-- 028: Permite prioridade padrão em department, category e subcategory
-- 2026-04-11
-- Pré-requisito: 024_ticket_settings_default_priority.sql
-- ============================================================

ALTER TABLE ticket_settings
  DROP CONSTRAINT IF EXISTS ticket_settings_default_priority_department_only_chk;

ALTER TABLE ticket_settings
  ADD CONSTRAINT ticket_settings_default_priority_allowed_types_chk
  CHECK (
    type::text IN ('department', 'category', 'subcategory')
    OR default_priority_id IS NULL
  );
