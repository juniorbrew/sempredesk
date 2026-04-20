-- Migration 048 — Índice único parcial em calendar_event_participants(event_id, user_id)
--
-- O que faz:
--   Impede que o mesmo usuário seja adicionado duas vezes como participante
--   no mesmo evento. O índice é parcial (WHERE user_id IS NOT NULL) para
--   preservar múltiplos participantes externos/contatos no mesmo evento.
--
-- O que NÃO faz:
--   Não altera colunas, não remove dados existentes.
--
-- Rollback:
--   DROP INDEX IF EXISTS uq_cal_participants_event_user;

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cal_participants_event_user
  ON calendar_event_participants(event_id, user_id)
  WHERE user_id IS NOT NULL;

COMMIT;
