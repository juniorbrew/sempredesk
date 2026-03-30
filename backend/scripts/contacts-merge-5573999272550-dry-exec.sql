-- Merge transacional de contatos duplicados para o numero 5573999272550.
-- Modo ENSAIO SEGURO: executa toda a logica e termina com ROLLBACK.
--
-- Canonico:
--   6c3b7494-a383-4f54-b2a8-34b52850cfd2
--
-- Duplicados:
--   07c86573-4a29-4cf0-8b39-0a17acc2bc72
--   78ee25d9-2534-482c-b90a-1123c6204f03
--   c17ee153-edb5-451d-af6f-fa119a33ef4c
--   76774e2a-5ac5-4908-a59d-267f7a0b17f1
--
-- Estrategia:
-- 1. Validar se todos os contatos pertencem ao mesmo numero normalizado.
-- 2. Migrar conversations.contact_id para o canonico.
-- 3. Migrar tickets.contact_id para o canonico.
-- 4. Consolidar contact_customers no canonico sem violar unicidade.
-- 5. Remover vinculos antigos de contact_customers dos duplicados.
-- 6. Inativar os contatos duplicados no final.
--
-- Observacao:
-- - Este script NAO altera indice unico.
-- - Este script opta por INATIVAR os duplicados, em vez de deletar.
-- - Os campos contact_id sao tratados como texto nas tabelas filhas.
-- - Ao final, usa ROLLBACK para desfazer tudo apos os SELECTs de validacao.

-- =========================================================
-- VALIDACAO ANTES DO MERGE
-- =========================================================

WITH target_contacts AS (
  SELECT *
  FROM contacts
  WHERE id = ANY(ARRAY[
    '6c3b7494-a383-4f54-b2a8-34b52850cfd2',
    '07c86573-4a29-4cf0-8b39-0a17acc2bc72',
    '78ee25d9-2534-482c-b90a-1123c6204f03',
    'c17ee153-edb5-451d-af6f-fa119a33ef4c',
    '76774e2a-5ac5-4908-a59d-267f7a0b17f1'
  ]::uuid[])
)
SELECT
  id,
  tenant_id,
  client_id,
  name,
  whatsapp,
  REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '', 'g') AS whatsapp_normalized,
  status,
  is_primary,
  created_at
FROM target_contacts
ORDER BY created_at, id;

SELECT
  'conversations' AS table_name,
  contact_id,
  COUNT(*) AS row_count
FROM conversations
WHERE contact_id IN (
  '6c3b7494-a383-4f54-b2a8-34b52850cfd2',
  '07c86573-4a29-4cf0-8b39-0a17acc2bc72',
  '78ee25d9-2534-482c-b90a-1123c6204f03',
  'c17ee153-edb5-451d-af6f-fa119a33ef4c',
  '76774e2a-5ac5-4908-a59d-267f7a0b17f1'
)
GROUP BY contact_id

UNION ALL

SELECT
  'tickets' AS table_name,
  contact_id,
  COUNT(*) AS row_count
FROM tickets
WHERE contact_id IN (
  '6c3b7494-a383-4f54-b2a8-34b52850cfd2',
  '07c86573-4a29-4cf0-8b39-0a17acc2bc72',
  '78ee25d9-2534-482c-b90a-1123c6204f03',
  'c17ee153-edb5-451d-af6f-fa119a33ef4c',
  '76774e2a-5ac5-4908-a59d-267f7a0b17f1'
)
GROUP BY contact_id

UNION ALL

SELECT
  'contact_customers' AS table_name,
  contact_id,
  COUNT(*) AS row_count
FROM contact_customers
WHERE contact_id IN (
  '6c3b7494-a383-4f54-b2a8-34b52850cfd2',
  '07c86573-4a29-4cf0-8b39-0a17acc2bc72',
  '78ee25d9-2534-482c-b90a-1123c6204f03',
  'c17ee153-edb5-451d-af6f-fa119a33ef4c',
  '76774e2a-5ac5-4908-a59d-267f7a0b17f1'
)
GROUP BY contact_id
ORDER BY table_name, contact_id;

SELECT
  cc.tenant_id,
  cc.client_id,
  cc.contact_id,
  cc.linked_by,
  cc.linked_at
FROM contact_customers cc
WHERE cc.contact_id IN (
  '6c3b7494-a383-4f54-b2a8-34b52850cfd2',
  '07c86573-4a29-4cf0-8b39-0a17acc2bc72',
  '78ee25d9-2534-482c-b90a-1123c6204f03',
  'c17ee153-edb5-451d-af6f-fa119a33ef4c',
  '76774e2a-5ac5-4908-a59d-267f7a0b17f1'
)
ORDER BY cc.client_id, cc.contact_id;

SELECT
  cc.tenant_id,
  cc.client_id,
  COUNT(*) AS rows_on_duplicates
FROM contact_customers cc
WHERE cc.contact_id IN (
  '07c86573-4a29-4cf0-8b39-0a17acc2bc72',
  '78ee25d9-2534-482c-b90a-1123c6204f03',
  'c17ee153-edb5-451d-af6f-fa119a33ef4c',
  '76774e2a-5ac5-4908-a59d-267f7a0b17f1'
)
GROUP BY cc.tenant_id, cc.client_id
HAVING COUNT(*) > 1
ORDER BY cc.client_id;

-- =========================================================
-- MERGE TRANSACIONAL
-- =========================================================

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

CREATE TEMP TABLE merge_target_contacts (
  canonical_contact_id uuid NOT NULL,
  duplicate_contact_id uuid NOT NULL,
  whatsapp_normalized text NOT NULL
) ON COMMIT DROP;

INSERT INTO merge_target_contacts (canonical_contact_id, duplicate_contact_id, whatsapp_normalized)
VALUES
  ('6c3b7494-a383-4f54-b2a8-34b52850cfd2', '07c86573-4a29-4cf0-8b39-0a17acc2bc72', '5573999272550'),
  ('6c3b7494-a383-4f54-b2a8-34b52850cfd2', '78ee25d9-2534-482c-b90a-1123c6204f03', '5573999272550'),
  ('6c3b7494-a383-4f54-b2a8-34b52850cfd2', 'c17ee153-edb5-451d-af6f-fa119a33ef4c', '5573999272550'),
  ('6c3b7494-a383-4f54-b2a8-34b52850cfd2', '76774e2a-5ac5-4908-a59d-267f7a0b17f1', '5573999272550');

DO $$
DECLARE
  v_total_contacts integer;
  v_invalid_contacts integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM merge_target_contacts
    WHERE canonical_contact_id = duplicate_contact_id
  ) THEN
    RAISE EXCEPTION 'Merge invalido: canonico e duplicado nao podem ser iguais';
  END IF;

  SELECT COUNT(*)
    INTO v_total_contacts
  FROM contacts
  WHERE id IN (
    SELECT canonical_contact_id FROM merge_target_contacts
    UNION
    SELECT duplicate_contact_id FROM merge_target_contacts
  );

  IF v_total_contacts <> 5 THEN
    RAISE EXCEPTION 'Merge abortado: esperado encontrar 5 contatos, encontrado %', v_total_contacts;
  END IF;

  SELECT COUNT(*)
    INTO v_invalid_contacts
  FROM contacts c
  WHERE c.id IN (
    SELECT canonical_contact_id FROM merge_target_contacts
    UNION
    SELECT duplicate_contact_id FROM merge_target_contacts
  )
    AND REGEXP_REPLACE(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g') <> '5573999272550';

  IF v_invalid_contacts > 0 THEN
    RAISE EXCEPTION 'Merge abortado: existem contatos fora do numero 5573999272550';
  END IF;
END $$;

-- Snapshot interno antes da migracao
SELECT
  'before' AS phase,
  'conversations' AS table_name,
  contact_id,
  COUNT(*) AS row_count
FROM conversations
WHERE contact_id IN (
  SELECT canonical_contact_id::text FROM merge_target_contacts
  UNION
  SELECT duplicate_contact_id::text FROM merge_target_contacts
)
GROUP BY contact_id

UNION ALL

SELECT
  'before' AS phase,
  'tickets' AS table_name,
  contact_id,
  COUNT(*) AS row_count
FROM tickets
WHERE contact_id IN (
  SELECT canonical_contact_id::text FROM merge_target_contacts
  UNION
  SELECT duplicate_contact_id::text FROM merge_target_contacts
)
GROUP BY contact_id

UNION ALL

SELECT
  'before' AS phase,
  'contact_customers' AS table_name,
  contact_id,
  COUNT(*) AS row_count
FROM contact_customers
WHERE contact_id IN (
  SELECT canonical_contact_id::text FROM merge_target_contacts
  UNION
  SELECT duplicate_contact_id::text FROM merge_target_contacts
)
GROUP BY contact_id
ORDER BY table_name, contact_id;

-- 1. conversations.contact_id -> canonico
UPDATE conversations c
SET contact_id = mt.canonical_contact_id::text
FROM merge_target_contacts mt
WHERE c.contact_id = mt.duplicate_contact_id::text;

-- 2. tickets.contact_id -> canonico
UPDATE tickets t
SET contact_id = mt.canonical_contact_id::text
FROM merge_target_contacts mt
WHERE t.contact_id = mt.duplicate_contact_id::text;

-- 3. contact_customers.contact_id -> consolidar no canonico sem duplicar
INSERT INTO contact_customers (
  tenant_id,
  contact_id,
  client_id,
  linked_by,
  linked_at
)
SELECT DISTINCT ON (cc.tenant_id, cc.client_id)
  cc.tenant_id,
  mt.canonical_contact_id::text AS contact_id,
  cc.client_id,
  cc.linked_by,
  cc.linked_at
FROM contact_customers cc
JOIN merge_target_contacts mt
  ON cc.contact_id = mt.duplicate_contact_id::text
WHERE NOT EXISTS (
  SELECT 1
  FROM contact_customers existing
  WHERE existing.tenant_id = cc.tenant_id
    AND existing.contact_id = mt.canonical_contact_id::text
    AND existing.client_id = cc.client_id
)
ORDER BY cc.tenant_id, cc.client_id, cc.linked_at, cc.contact_id;

DELETE FROM contact_customers cc
USING merge_target_contacts mt
WHERE cc.contact_id = mt.duplicate_contact_id::text;

-- 4. inativar contatos duplicados no final
UPDATE contacts c
SET
  status = 'inactive',
  is_primary = false
WHERE c.id IN (
  SELECT duplicate_contact_id
  FROM merge_target_contacts
);

-- =========================================================
-- VALIDACAO DEPOIS DO MERGE
-- =========================================================

SELECT
  id,
  tenant_id,
  client_id,
  name,
  whatsapp,
  REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '', 'g') AS whatsapp_normalized,
  status,
  is_primary,
  created_at
FROM contacts
WHERE id IN (
  SELECT canonical_contact_id FROM merge_target_contacts
  UNION
  SELECT duplicate_contact_id FROM merge_target_contacts
)
ORDER BY created_at, id;

SELECT
  'after' AS phase,
  'conversations' AS table_name,
  contact_id,
  COUNT(*) AS row_count
FROM conversations
WHERE contact_id IN (
  SELECT canonical_contact_id::text FROM merge_target_contacts
  UNION
  SELECT duplicate_contact_id::text FROM merge_target_contacts
)
GROUP BY contact_id

UNION ALL

SELECT
  'after' AS phase,
  'tickets' AS table_name,
  contact_id,
  COUNT(*) AS row_count
FROM tickets
WHERE contact_id IN (
  SELECT canonical_contact_id::text FROM merge_target_contacts
  UNION
  SELECT duplicate_contact_id::text FROM merge_target_contacts
)
GROUP BY contact_id

UNION ALL

SELECT
  'after' AS phase,
  'contact_customers' AS table_name,
  contact_id,
  COUNT(*) AS row_count
FROM contact_customers
WHERE contact_id IN (
  SELECT canonical_contact_id::text FROM merge_target_contacts
  UNION
  SELECT duplicate_contact_id::text FROM merge_target_contacts
)
GROUP BY contact_id
ORDER BY table_name, contact_id;

SELECT
  'remaining_duplicate_refs' AS validation_name,
  COALESCE(SUM(row_count), 0) AS remaining_rows
FROM (
  SELECT COUNT(*) AS row_count
  FROM conversations
  WHERE contact_id IN (SELECT duplicate_contact_id::text FROM merge_target_contacts)

  UNION ALL

  SELECT COUNT(*) AS row_count
  FROM tickets
  WHERE contact_id IN (SELECT duplicate_contact_id::text FROM merge_target_contacts)

  UNION ALL

  SELECT COUNT(*) AS row_count
  FROM contact_customers
  WHERE contact_id IN (SELECT duplicate_contact_id::text FROM merge_target_contacts)
) remaining;

SELECT
  cc.tenant_id,
  cc.client_id,
  cc.contact_id,
  cc.linked_by,
  cc.linked_at
FROM contact_customers cc
WHERE cc.contact_id = '6c3b7494-a383-4f54-b2a8-34b52850cfd2'
ORDER BY cc.client_id, cc.linked_at, cc.contact_id;

ROLLBACK;
