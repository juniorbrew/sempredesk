-- ================================================================
-- Migration: Renumerar tickets para formato #000001
-- Ordem: por created_at (mais antigo primeiro)
-- Executar: psql -U postgres -d suporte_tecnico -f 001_renumber_tickets_to_hash_format.sql
-- ================================================================

BEGIN;

-- Passo 1: Atualizar para valores temporários (evita conflito de UNIQUE)
UPDATE tickets SET ticket_number = 'TMP_' || id::text;

-- Passo 2: Atribuir #000001, #000002... em ordem de created_at (global)
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM tickets
)
UPDATE tickets t
SET ticket_number = '#' || LPAD(o.rn::text, 6, '0')
FROM ordered o
WHERE t.id = o.id;

COMMIT;
