-- Formaliza colunas adicionadas ao chatbot em runtime.
-- Mantém compatibilidade com bancos existentes sem alterar regra de negócio.

ALTER TABLE chatbot_configs
  ADD COLUMN IF NOT EXISTS collect_name boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS name_request_message text NOT NULL DEFAULT 'Olá! Para começarmos, pode me informar seu nome completo?';
