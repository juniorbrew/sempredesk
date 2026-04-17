-- ============================================================
-- Adiciona department_id (UUID) como chave canônica estável em
-- chatbot_menu_items, conversations e tickets.
-- Mantém as colunas de nome (department / chatbot_department)
-- para compatibilidade e exibição — elas NÃO são removidas aqui.
-- ============================================================

-- 1. chatbot_menu_items.department_id
ALTER TABLE chatbot_menu_items
  ADD COLUMN IF NOT EXISTS department_id UUID
    REFERENCES ticket_settings(id) ON DELETE SET NULL;

-- 2. conversations.chatbot_department_id
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS chatbot_department_id UUID
    REFERENCES ticket_settings(id) ON DELETE SET NULL;

-- 3. tickets.department_id
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS department_id UUID
    REFERENCES ticket_settings(id) ON DELETE SET NULL;

-- Índices para lookups e JOINs futuros
CREATE INDEX IF NOT EXISTS idx_chatbot_menu_items_department_id
  ON chatbot_menu_items(department_id) WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_chatbot_department_id
  ON conversations(chatbot_department_id) WHERE chatbot_department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_department_id
  ON tickets(department_id) WHERE department_id IS NOT NULL;

-- ── Backfill: chatbot_menu_items ─────────────────────────────────────────────
UPDATE chatbot_menu_items cmi
SET    department_id = ts.id
FROM   ticket_settings ts
WHERE  ts.tenant_id = cmi.tenant_id
  AND  ts.type      = 'department'
  AND  LOWER(TRIM(ts.name)) = LOWER(TRIM(cmi.department))
  AND  cmi.department    IS NOT NULL
  AND  cmi.department_id IS NULL;

-- ── Backfill: conversations ──────────────────────────────────────────────────
UPDATE conversations c
SET    chatbot_department_id = ts.id
FROM   ticket_settings ts
WHERE  ts.tenant_id::text = c.tenant_id::text
  AND  ts.type            = 'department'
  AND  LOWER(TRIM(ts.name)) = LOWER(TRIM(c.chatbot_department))
  AND  c.chatbot_department    IS NOT NULL
  AND  c.chatbot_department_id IS NULL;

-- ── Backfill: tickets ────────────────────────────────────────────────────────
UPDATE tickets t
SET    department_id = ts.id
FROM   ticket_settings ts
WHERE  ts.tenant_id::text = t.tenant_id::text
  AND  ts.type            = 'department'
  AND  LOWER(TRIM(ts.name)) = LOWER(TRIM(t.department))
  AND  t.department    IS NOT NULL
  AND  t.department_id IS NULL;
