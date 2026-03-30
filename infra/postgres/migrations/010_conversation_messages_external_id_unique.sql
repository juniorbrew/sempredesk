-- Idempotência inbound WhatsApp/Meta: um external_id por tenant.
-- Executar após eliminar duplicatas manuais, se existirem:
--   SELECT tenant_id, external_id, COUNT(*) FROM conversation_messages
--   WHERE external_id IS NOT NULL GROUP BY 1,2 HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_messages_tenant_external_id
  ON conversation_messages (tenant_id, external_id)
  WHERE external_id IS NOT NULL AND btrim(external_id) <> '';
