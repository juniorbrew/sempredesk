-- 014_ticket_reply_attachments.sql
-- Anexos da resposta pública do ticket (domínio ticket, separado de conversation_messages).
-- ETAPA 1: apenas DDL; nenhum dado; frontend e endpoints antigos inalterados.

CREATE TABLE IF NOT EXISTS ticket_reply_attachments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           VARCHAR         NOT NULL,
  ticket_message_id   UUID            NOT NULL REFERENCES ticket_messages (id) ON DELETE CASCADE,
  storage_key         TEXT            NOT NULL,
  mime                VARCHAR(256),
  size_bytes          BIGINT,
  original_filename   TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_reply_attachments_tenant_message
  ON ticket_reply_attachments (tenant_id, ticket_message_id);

CREATE INDEX IF NOT EXISTS idx_ticket_reply_attachments_tenant_created
  ON ticket_reply_attachments (tenant_id, created_at);
