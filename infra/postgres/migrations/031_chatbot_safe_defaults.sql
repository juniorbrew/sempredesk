-- Alinha defaults de chatbot_configs com o modelo atual.
-- Não altera registros existentes; só o default para novos inserts.

ALTER TABLE chatbot_configs
  ALTER COLUMN enabled SET DEFAULT false;

ALTER TABLE chatbot_configs
  ALTER COLUMN channel_whatsapp SET DEFAULT false;
