-- Migration 033 — CHECK CONSTRAINTs de formato UUID + índice de suporte
-- Fase 2 do PLANO_CORRECAO_BANCO.md
--
-- Revisado em 2026-04-18 após auditoria completa.
-- Problema no rascunho original: CREATE INDEX CONCURRENTLY não pode rodar dentro de
-- bloco BEGIN/COMMIT no PostgreSQL. Separado em dois blocos abaixo.
--
-- O que faz:
--   1. CHECK CONSTRAINT (NOT VALID): ticket_messages.ticket_id deve ser UUID bem formado
--   2. CHECK CONSTRAINT (NOT VALID): conversations.contact_id deve ser UUID (quando preenchido)
--   3. CHECK CONSTRAINT (NOT VALID): users.tenant_id deve ser UUID (quando preenchido)
--   4. CREATE INDEX CONCURRENTLY: conversations(tenant_id, contact_id)
--
-- O que NÃO faz:
--   - Não cria FKs referenciais (colunas ainda são varchar — Fase 3/4)
--   - Não escaneia dados históricos (NOT VALID em todos os CHECKs)
--   - Não dropa nem altera tipos
--
-- Dados verificados antes da aplicação (2026-04-18):
--   - ticket_messages.ticket_id: 0 valores fora do formato UUID (434 registros)
--   - conversations.contact_id:  0 valores fora do formato UUID
--   - users.tenant_id:           0 valores fora do formato UUID
--   - Órfão documentado: 1 ticket_message (id=5967a13b) com ticket_id inexistente
--     (ticket provavelmente deletado; não afeta CHECK de formato; investigar separadamente)
--
-- Reversão:
--   ALTER TABLE ticket_messages  DROP CONSTRAINT IF EXISTS chk_ticket_messages_ticket_id_uuid_format;
--   ALTER TABLE conversations     DROP CONSTRAINT IF EXISTS chk_conversations_contact_id_uuid_format;
--   ALTER TABLE users             DROP CONSTRAINT IF EXISTS chk_users_tenant_id_uuid_format;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_conversations_contact_id;

-- ── BLOCO 1: CHECK CONSTRAINTs (transacional) ────────────────────────────────

BEGIN;

-- 1. ticket_messages.ticket_id: garante que novos inserts usem UUID válido
ALTER TABLE ticket_messages
  ADD CONSTRAINT chk_ticket_messages_ticket_id_uuid_format
  CHECK (ticket_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  NOT VALID;

-- 2. conversations.contact_id: aceita NULL (coluna técnica NOT NULL mas check defensive)
ALTER TABLE conversations
  ADD CONSTRAINT chk_conversations_contact_id_uuid_format
  CHECK (contact_id IS NULL OR contact_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  NOT VALID;

-- 3. users.tenant_id: nullable no schema
ALTER TABLE users
  ADD CONSTRAINT chk_users_tenant_id_uuid_format
  CHECK (tenant_id IS NULL OR tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  NOT VALID;

COMMIT;

-- ── BLOCO 2: ÍNDICE (fora de transação — CONCURRENTLY é proibido em BEGIN/COMMIT) ──

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_contact_id
  ON conversations(tenant_id, contact_id)
  WHERE contact_id IS NOT NULL;
