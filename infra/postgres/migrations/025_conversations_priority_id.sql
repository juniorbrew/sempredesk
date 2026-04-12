-- ============================================================
-- 025: Prioridade da conversa (pré-ticket) — Fase 3
-- Pré-requisito: 023_tenant_priorities.sql
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS priority_id UUID NULL
    REFERENCES tenant_priorities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_priority
  ON conversations (tenant_id, priority_id)
  WHERE priority_id IS NOT NULL;
