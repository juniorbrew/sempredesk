-- 20260402_ticket_reply_attachments.sql
-- Coluna ticket_id em ticket_reply_attachments (além de ticket_message_id).
-- Executar após 014_ticket_reply_attachments.sql quando aplicável.

ALTER TABLE ticket_reply_attachments
  ADD COLUMN IF NOT EXISTS ticket_id VARCHAR;

UPDATE ticket_reply_attachments tra
SET ticket_id = tm.ticket_id
FROM ticket_messages tm
WHERE tra.ticket_message_id = tm.id
  AND (tra.ticket_id IS NULL OR tra.ticket_id = '');

ALTER TABLE ticket_reply_attachments
  ALTER COLUMN ticket_id SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_ticket_reply_attachments_ticket'
  ) THEN
    ALTER TABLE ticket_reply_attachments
      ADD CONSTRAINT fk_ticket_reply_attachments_ticket
      FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE;
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_ticket_reply_attachments_tenant_ticket
  ON ticket_reply_attachments (tenant_id, ticket_id);
