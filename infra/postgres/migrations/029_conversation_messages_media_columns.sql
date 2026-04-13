-- Formaliza colunas de mídia/idempotência/reply em conversation_messages.
-- Substitui a antiga compatibilidade feita em runtime pelo ConversationsService.

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS media_kind varchar(16),
  ADD COLUMN IF NOT EXISTS media_storage_key text,
  ADD COLUMN IF NOT EXISTS media_mime varchar(128),
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_status text,
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES conversation_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conv_messages_reply_to
  ON conversation_messages(reply_to_id)
  WHERE reply_to_id IS NOT NULL;
