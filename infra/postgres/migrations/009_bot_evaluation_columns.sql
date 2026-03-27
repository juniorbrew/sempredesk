-- Migration 009: Bot evaluation columns + post-ticket messages
--
-- Cobre as Etapas 2B e 2C do bot de atendimento:
--
-- Etapa 2B — Mensagem automática após criação do ticket
--   chatbot_configs.post_ticket_message          — template com agente
--   chatbot_configs.post_ticket_message_no_agent — template sem agente
--
-- Etapa 2C — Avaliação do atendimento via WhatsApp
--   chatbot_configs.rating_request_message   — solicitação de nota 1–5
--   chatbot_configs.rating_comment_message   — pedido de comentário opcional
--   chatbot_configs.rating_thanks_message    — agradecimento final
--   tickets.satisfaction_rating              — nota numérica 1–5
--   tickets.satisfaction_comment             — comentário opcional
--
-- Índice de lookup em chatbot_sessions:
--   Criado via migration 005 mas ausente no banco atual; recriar de forma idempotente.
--
-- Todos os ALTER TABLE usam IF NOT EXISTS / IF EXISTS para idempotência:
-- pode ser executado mais de uma vez sem erro.

-- ─── chatbot_configs: mensagens pós-ticket ───────────────────────────────────

ALTER TABLE chatbot_configs
  ADD COLUMN IF NOT EXISTS post_ticket_message          TEXT,
  ADD COLUMN IF NOT EXISTS post_ticket_message_no_agent TEXT;

COMMENT ON COLUMN chatbot_configs.post_ticket_message IS
  'Template enviado ao cliente após criação do ticket (com agente atribuído). '
  'Variáveis: {contato}, {empresa_atendente}, {agente}, {numero_ticket}';

COMMENT ON COLUMN chatbot_configs.post_ticket_message_no_agent IS
  'Template enviado ao cliente após criação do ticket (sem agente atribuído). '
  'Variáveis: {contato}, {empresa_atendente}, {numero_ticket}';

-- ─── chatbot_configs: mensagens de avaliação ────────────────────────────────

ALTER TABLE chatbot_configs
  ADD COLUMN IF NOT EXISTS rating_request_message TEXT,
  ADD COLUMN IF NOT EXISTS rating_comment_message TEXT,
  ADD COLUMN IF NOT EXISTS rating_thanks_message  TEXT;

COMMENT ON COLUMN chatbot_configs.rating_request_message IS
  'Mensagem enviada ao fechar o atendimento, solicitando nota de 1 a 5.';

COMMENT ON COLUMN chatbot_configs.rating_comment_message IS
  'Mensagem enviada após a nota, solicitando comentário opcional. '
  'Palavras "pular", "nao", "skip" encerram sem comentário.';

COMMENT ON COLUMN chatbot_configs.rating_thanks_message IS
  'Mensagem de agradecimento após conclusão da avaliação.';

-- ─── tickets: nota e comentário numérico ────────────────────────────────────

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS satisfaction_rating  INTEGER,
  ADD COLUMN IF NOT EXISTS satisfaction_comment TEXT;

COMMENT ON COLUMN tickets.satisfaction_rating IS
  'Nota de 1 a 5 enviada pelo cliente via WhatsApp ao final do atendimento.';

COMMENT ON COLUMN tickets.satisfaction_comment IS
  'Comentário opcional vinculado à avaliação numérica.';

-- Constraint: nota deve ser NULL ou entre 1 e 5
-- Usa DROP + ADD para ser idempotente (IF NOT EXISTS não existe para constraints CHECK no PG)
ALTER TABLE tickets
  DROP CONSTRAINT IF EXISTS tickets_satisfaction_rating_range;

ALTER TABLE tickets
  ADD CONSTRAINT tickets_satisfaction_rating_range
    CHECK (satisfaction_rating IS NULL OR (satisfaction_rating >= 1 AND satisfaction_rating <= 5));

-- ─── chatbot_sessions: índice de lookup (ausente no banco atual) ─────────────
-- Necessário para performance em findOne({ tenantId, identifier, channel })
-- usado por processMessage() e initiateRating().

CREATE INDEX IF NOT EXISTS chatbot_sessions_lookup_idx
  ON chatbot_sessions (tenant_id, identifier, channel);
