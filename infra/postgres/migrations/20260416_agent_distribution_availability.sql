-- Disponibilidade para distribuição automática de chamados
-- Permite definir janela de horário em que o agente aceita novos chamados via round-robin.
-- Agentes com a regra desativada (padrão) continuam funcionando exatamente como antes.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS distribution_availability_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS distribution_start_time           VARCHAR(5)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS distribution_end_time             VARCHAR(5)  DEFAULT NULL;

COMMENT ON COLUMN users.distribution_availability_enabled IS
  'Quando true, o agente só entra no round-robin dentro da janela start..end';
COMMENT ON COLUMN users.distribution_start_time IS 'Horário inicial no formato HH:MM';
COMMENT ON COLUMN users.distribution_end_time   IS 'Horário final no formato HH:MM';
