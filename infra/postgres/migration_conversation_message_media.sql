-- Executar na VPS se DB_SYNCHRONIZE=false (produção).
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS media_kind VARCHAR(16) NULL;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS media_storage_key TEXT NULL;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS media_mime VARCHAR(128) NULL;
