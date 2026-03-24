-- Migration 005: Chatbot tables
-- Creates chatbot_configs, chatbot_menu_items, chatbot_sessions, chatbot_widget_messages

CREATE TABLE IF NOT EXISTS chatbot_configs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      VARCHAR NOT NULL,
  name           VARCHAR NOT NULL DEFAULT 'Assistente Virtual',
  welcome_message TEXT NOT NULL DEFAULT 'Olá! Seja bem-vindo. Como posso te ajudar hoje?',
  menu_title     VARCHAR NOT NULL DEFAULT 'Escolha uma das opções abaixo:',
  enabled        BOOLEAN NOT NULL DEFAULT true,
  channel_whatsapp BOOLEAN NOT NULL DEFAULT true,
  channel_web    BOOLEAN NOT NULL DEFAULT false,
  channel_portal BOOLEAN NOT NULL DEFAULT false,
  transfer_message TEXT DEFAULT 'Aguarde um momento, estou te conectando com um atendente...',
  no_agent_message TEXT DEFAULT 'No momento todos os atendentes estão ocupados. Sua mensagem foi registrada e entraremos em contato em breve.',
  invalid_option_message TEXT DEFAULT 'Opção inválida. Por favor, escolha uma das opções do menu:',
  session_timeout_minutes INT NOT NULL DEFAULT 30,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS chatbot_configs_tenant_idx ON chatbot_configs(tenant_id);

CREATE TABLE IF NOT EXISTS chatbot_menu_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      VARCHAR NOT NULL,
  chatbot_id     UUID NOT NULL REFERENCES chatbot_configs(id) ON DELETE CASCADE,
  "order"        INT NOT NULL,
  label          VARCHAR NOT NULL,
  action         VARCHAR NOT NULL DEFAULT 'transfer',
  auto_reply_text TEXT,
  department     VARCHAR,
  enabled        BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS chatbot_menu_chatbot_idx ON chatbot_menu_items(chatbot_id);

CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      VARCHAR NOT NULL,
  identifier     VARCHAR NOT NULL,
  channel        VARCHAR NOT NULL DEFAULT 'whatsapp',
  step           VARCHAR NOT NULL DEFAULT 'welcome',
  conversation_id VARCHAR,
  contact_id     VARCHAR,
  last_activity  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chatbot_sessions_lookup_idx ON chatbot_sessions(tenant_id, identifier, channel);

CREATE TABLE IF NOT EXISTS chatbot_widget_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      VARCHAR NOT NULL,
  session_id     VARCHAR NOT NULL,
  role           VARCHAR NOT NULL,
  content        TEXT NOT NULL,
  is_read        BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chatbot_widget_msgs_session_idx ON chatbot_widget_messages(session_id, created_at);
