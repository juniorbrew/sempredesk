-- Migration 008: Contact-Customer N:N pivot + ticket validation fields
--
-- Objetivo:
--   1. Criar tabela contact_customers (N:N entre Contact e Client)
--      sem quebrar o vínculo 1-N existente (contacts.client_id permanece intacto).
--   2. Adicionar campos de validação ao ticket:
--        unlinked_contact      — agente pulou a vinculação
--        customer_selected_at  — momento em que o agente confirmou o cliente real
--   3. Tornar tickets.client_id nullable para suportar tickets WhatsApp antes
--      de o agente associar ao cliente real.

-- ─── Tabela pivot ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_customers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  contact_id  UUID        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  client_id   UUID        NOT NULL REFERENCES clients(id)  ON DELETE CASCADE,
  linked_by   UUID,                      -- user_id do agente que criou o vínculo
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contact_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_customers_contact
  ON contact_customers (tenant_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_customers_client
  ON contact_customers (tenant_id, client_id);

-- ─── Campos de validação no ticket ──────────────────────────────────────────
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS unlinked_contact     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS customer_selected_at TIMESTAMPTZ;

-- ─── client_id nullable ──────────────────────────────────────────────────────
-- Tickets criados via WhatsApp auto-criado ficam sem cliente real até validação.
-- ALTER COLUMN ... DROP NOT NULL é idempotente.
ALTER TABLE tickets
  ALTER COLUMN client_id DROP NOT NULL;
