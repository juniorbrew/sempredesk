-- ============================================================
-- 016_whatsapp_multi_channel.sql
-- Evolução para suporte a múltiplos números WhatsApp por empresa
--
-- O que faz:
--   1. Adiciona `label` e `is_default` em whatsapp_connections
--   2. Remove a constraint UNIQUE de tenant_id (era 1 número por empresa)
--   3. Cria índice único composto (tenant_id, meta_phone_number_id) para Meta
--   4. Faz backfill: registros existentes ficam is_default = true
--   5. Adiciona whatsapp_channel_id em conversations (FK nullable)
--   6. Faz backfill: conversas WhatsApp existentes vinculadas ao canal default
--   7. Adiciona whatsapp_channel_id em chatbot_sessions (FK nullable)
--
-- Compatibilidade retroativa:
--   - Todas as colunas novas são nullable ou têm default
--   - Registros existentes não são removidos nem alterados (exceto is_default=true)
--   - Conversas sem canal continuam funcionando via fallback is_default
-- ============================================================

BEGIN;

-- ─── 1. Novas colunas em whatsapp_connections ────────────────────────────────
ALTER TABLE whatsapp_connections
  ADD COLUMN IF NOT EXISTS label       VARCHAR(100) NOT NULL DEFAULT 'Principal',
  ADD COLUMN IF NOT EXISTS is_default  BOOLEAN      NOT NULL DEFAULT false;

-- ─── 2. Backfill: todos os registros existentes são o canal default do tenant ─
UPDATE whatsapp_connections
  SET is_default = true
  WHERE is_default = false;

-- ─── 3. Remove UNIQUE de tenant_id (permite múltiplos números por tenant) ────
-- TypeORM pode gerar nomes diferentes dependendo da versão — derrubamos ambos
ALTER TABLE whatsapp_connections
  DROP CONSTRAINT IF EXISTS whatsapp_connections_tenant_id_key;
ALTER TABLE whatsapp_connections
  DROP CONSTRAINT IF EXISTS "UQ_72cde483b65e898479536b08f7d";

-- ─── 4. Índice único composto para Meta (tenant + phoneNumberId) ──────────────
--    WHERE exclui Baileys e registros sem phoneNumberId configurado
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_connections_tenant_meta_phone
  ON whatsapp_connections (tenant_id, meta_phone_number_id)
  WHERE meta_phone_number_id IS NOT NULL
    AND btrim(meta_phone_number_id) <> '';

-- ─── 5. whatsapp_channel_id em conversations ─────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_channel_id UUID
    REFERENCES whatsapp_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_channel_id
  ON conversations (whatsapp_channel_id)
  WHERE whatsapp_channel_id IS NOT NULL;

-- ─── 6. Backfill: vincular conversas WhatsApp existentes ao canal default ─────
--    Seguro: só atualiza se a conversa não tem canal vinculado ainda
UPDATE conversations c
  SET whatsapp_channel_id = wc.id
  FROM whatsapp_connections wc
  WHERE wc.tenant_id = c.tenant_id
    AND wc.is_default = true
    AND c.channel = 'whatsapp'
    AND c.whatsapp_channel_id IS NULL;

-- ─── 7. whatsapp_channel_id em chatbot_sessions ──────────────────────────────
ALTER TABLE chatbot_sessions
  ADD COLUMN IF NOT EXISTS whatsapp_channel_id UUID
    REFERENCES whatsapp_connections(id) ON DELETE SET NULL;

COMMIT;
