-- Prefixar nome do agente nas respostas WhatsApp (só no envio ao cliente; painel guarda texto puro).
ALTER TABLE chatbot_configs
  ADD COLUMN IF NOT EXISTS whatsapp_prefix_agent_name BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN chatbot_configs.whatsapp_prefix_agent_name IS
  'Se true, mensagens do atendente ao cliente via WhatsApp incluem linha *Nome* (negrito WA) antes do texto.';
