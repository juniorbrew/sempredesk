-- =============================================================================
-- Habilita chatbot para o tenant Demo Automação Comercial
-- e corrige collect_cnpj para todos os tenants onde está false por engano.
--
-- QUANDO EXECUTAR: Após deploy do fix do rating (chatbot.service.ts).
--                  Seguro re-executar — operações são idempotentes.
-- =============================================================================

BEGIN;

-- Habilita chatbot para Demo Automação Comercial
UPDATE chatbot_configs
SET
  enabled = true,
  channel_whatsapp = true,
  collect_cnpj = true,
  updated_at = NOW()
WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

-- Confirmação
SELECT
  tenant_id,
  enabled,
  channel_whatsapp,
  collect_cnpj,
  collect_name,
  updated_at
FROM chatbot_configs
ORDER BY created_at;

COMMIT;
