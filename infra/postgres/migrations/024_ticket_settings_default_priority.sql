-- ============================================================
-- 024: Prioridade padrão opcional em departamentos (ticket_settings)
-- Fase 2 — 2026-04-11
-- Pré-requisito: 023_tenant_priorities.sql
-- ============================================================

ALTER TABLE ticket_settings
  ADD COLUMN IF NOT EXISTS default_priority_id UUID NULL
    REFERENCES tenant_priorities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_settings_default_priority
  ON ticket_settings (default_priority_id)
  WHERE default_priority_id IS NOT NULL;

-- Só departamentos podem ter prioridade padrão; categorias/subcategorias permanecem NULL.
ALTER TABLE ticket_settings
  DROP CONSTRAINT IF EXISTS ticket_settings_default_priority_department_only_chk;

ALTER TABLE ticket_settings
  ADD CONSTRAINT ticket_settings_default_priority_department_only_chk
  CHECK (type::text = 'department' OR default_priority_id IS NULL);
