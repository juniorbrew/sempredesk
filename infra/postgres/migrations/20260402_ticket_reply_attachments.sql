-- 20260402_ticket_reply_attachments.sql
-- Coluna ticket_id em ticket_reply_attachments (além de ticket_message_id).
-- Executar após 014_ticket_reply_attachments.sql quando aplicável.
--
-- tickets.id é UUID; ticket_messages.ticket_id é VARCHAR (texto com UUID) —
-- usar UUID aqui para a FK com tickets(id).

-- Se uma execução antiga criou VARCHAR, converter antes da FK.
DO $fix_type$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ticket_reply_attachments'
      AND column_name = 'ticket_id'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE ticket_reply_attachments DROP CONSTRAINT IF EXISTS fk_ticket_reply_attachments_ticket;
    ALTER TABLE ticket_reply_attachments
      ALTER COLUMN ticket_id DROP NOT NULL;
    ALTER TABLE ticket_reply_attachments
      ALTER COLUMN ticket_id TYPE UUID USING (
        CASE
          WHEN ticket_id IS NULL OR btrim(ticket_id::text) = '' THEN NULL
          ELSE ticket_id::uuid
        END
      );
  END IF;
END
$fix_type$;

ALTER TABLE ticket_reply_attachments
  ADD COLUMN IF NOT EXISTS ticket_id UUID;

UPDATE ticket_reply_attachments tra
SET ticket_id = tm.ticket_id::uuid
FROM ticket_messages tm
WHERE tra.ticket_message_id = tm.id
  AND tra.ticket_id IS NULL;

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
