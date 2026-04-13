-- ============================================================
-- 20260413: Persiste o departamento escolhido no chatbot na conversa
-- Necessário para que startAttendance herde corretamente o departamento
-- ao criar o ticket — sem esse campo o nome era perdido após a transferência
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS chatbot_department text;

COMMENT ON COLUMN conversations.chatbot_department IS
  'Nome do departamento selecionado no chatbot (menu de opções). '
  'Usado como departamento padrão ao criar o ticket no startAttendance.';
