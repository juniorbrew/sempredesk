-- ============================================================
-- 019_active_conversation_uniqueness.sql
-- Garante no bootstrap novo e em bancos limpos que exista no
-- maximo 1 conversa ativa por tenant + contato + canal.
--
-- Em ambientes ja existentes, se houver duplicatas historicas,
-- a migration nao falha: apenas registra NOTICE e preserva a
-- correção em nivel de aplicacao ate a base ser saneada.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT tenant_id, contact_id, channel
      FROM conversations
      WHERE status = 'active'
      GROUP BY tenant_id, contact_id, channel
      HAVING COUNT(*) > 1
    ) duplicated
  ) THEN
    RAISE NOTICE 'Skipping uq_conversations_active_contact_channel because duplicate active conversations already exist.';
  ELSE
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_active_contact_channel
        ON conversations (tenant_id, contact_id, channel)
        WHERE status = ''active''
    ';
  END IF;
END
$$;
