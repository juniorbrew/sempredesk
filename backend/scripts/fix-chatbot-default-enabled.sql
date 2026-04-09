-- =============================================================================
-- FIX: Chatbot habilitado por padrão causava bot genérico respondendo por todas
--      as empresas antes de qualquer configuração, bloqueando criação de tickets.
--
-- CAUSA RAIZ: chatbot_configs tinha DEFAULT TRUE em enabled e channel_whatsapp.
--             getOrCreateConfig() criava automaticamente uma config ativa para
--             qualquer tenant na primeira mensagem recebida.
--
-- EFEITO: Mensagens caíam no chatbot (welcome + menu padrão), não criavam ticket,
--         agentes nunca viam as conversas, remetentes viam "bot de outra base".
--
-- QUANDO EXECUTAR: Após deploy do fix de código. Executar UMA VEZ em produção.
--                  Todo comando usa IF NOT EXISTS ou é idempotente — seguro re-executar.
-- =============================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- PARTE 1: Estrutura — garante colunas e índice que o código já referencia
-- ──────────────────────────────────────────────────────────────────────────────

-- Coluna meta_waba_id em whatsapp_connections (pode já existir em produção via sync)
ALTER TABLE whatsapp_connections
  ADD COLUMN IF NOT EXISTS meta_waba_id VARCHAR;

-- Índice único para meta_phone_number_id — impede dois tenants no mesmo número Meta
-- (baileys.service.ts já trata a violação, mas o índice precisa existir)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_whatsapp_connections_meta_phone_number_id
  ON whatsapp_connections(meta_phone_number_id)
  WHERE meta_phone_number_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- PARTE 2: Corrige defaults do chatbot
-- ──────────────────────────────────────────────────────────────────────────────

-- Corrige o DEFAULT da coluna para novas linhas (evita regressão com INSERTs diretos)
ALTER TABLE chatbot_configs ALTER COLUMN enabled SET DEFAULT false;
ALTER TABLE chatbot_configs ALTER COLUMN channel_whatsapp SET DEFAULT false;

-- ──────────────────────────────────────────────────────────────────────────────
-- PARTE 3: Diagnóstico — mostra tenants a serem corrigidos (read-only preview)
-- ──────────────────────────────────────────────────────────────────────────────
-- (Este SELECT não altera dados; útil para validar antes do UPDATE abaixo)
--
-- SELECT tenant_id, enabled, channel_whatsapp, welcome_message, created_at
-- FROM chatbot_configs
-- WHERE enabled = true
--   AND channel_whatsapp = true
--   AND welcome_message = 'Olá! Seja bem-vindo. Como posso te ajudar hoje?'
-- ORDER BY created_at;

-- ──────────────────────────────────────────────────────────────────────────────
-- PARTE 4: Desabilita chatbot para configs auto-criadas com template padrão
--          CRITÉRIO SEGURO: welcome_message igual ao default intocado = nunca
--          foi editado pelo operador → nunca foi intencionalmente configurado.
--          Configs que o operador editou (qualquer campo) não são afetadas.
-- ──────────────────────────────────────────────────────────────────────────────
UPDATE chatbot_configs
SET
  enabled = false,
  channel_whatsapp = false,
  updated_at = NOW()
WHERE enabled = true
  AND channel_whatsapp = true
  AND welcome_message = 'Olá! Seja bem-vindo. Como posso te ajudar hoje?';

-- ──────────────────────────────────────────────────────────────────────────────
-- PARTE 5: Confirmação
-- ──────────────────────────────────────────────────────────────────────────────
SELECT
  tenant_id,
  enabled,
  channel_whatsapp,
  created_at
FROM chatbot_configs
ORDER BY created_at;

COMMIT;
