-- ============================================================
-- 20260412: Metricas operacionais do chat de atendimento
-- Separa telemetria da conversa do SLA oficial do ticket
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_agent_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversation_closed_at timestamptz;

UPDATE conversations
   SET queued_at = COALESCE(queued_at, created_at)
 WHERE queued_at IS NULL;

UPDATE conversations
   SET conversation_closed_at = COALESCE(conversation_closed_at, updated_at)
 WHERE status = 'closed'
   AND conversation_closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_queued_at
  ON conversations(tenant_id, queued_at);

CREATE INDEX IF NOT EXISTS idx_conversations_attendance_started_at
  ON conversations(tenant_id, attendance_started_at)
  WHERE attendance_started_at IS NOT NULL;
