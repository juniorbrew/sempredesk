-- Dry-run de deduplicacao segura de contatos WhatsApp.
-- Nao executa UPDATE, DELETE ou INSERT.
--
-- Objetivo:
-- 1. Identificar duplicados por tenant + whatsapp normalizado (somente digitos)
-- 2. Escolher um contato canonico por grupo
-- 3. Medir impacto por tabela antes de qualquer merge real
--
-- Regras de escolha do canonico:
--   1) is_primary = true
--   2) mais conversas
--   3) mais mensagens
--   4) mais antigo
--   5) menor id como desempate deterministico
--
-- Como rodar:
-- docker exec -i suporte_postgres psql -U suporte -d suporte_tecnico -f /app/scripts/contacts-dedup-dry-run.sql

-- =========================================================
-- RELATORIO 1: principal (somente contatos active)
-- =========================================================

WITH base_contacts AS (
  SELECT
    c.id,
    c.tenant_id,
    c.client_id,
    c.name,
    c.whatsapp,
    REGEXP_REPLACE(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g') AS whatsapp_digits,
    c.is_primary,
    c.status,
    c.created_at
  FROM contacts c
  WHERE c.whatsapp IS NOT NULL
    AND TRIM(c.whatsapp) <> ''
),
eligible_contacts AS (
  SELECT *
  FROM base_contacts
  WHERE status = 'active'
    AND whatsapp NOT LIKE '%@%'
    AND LENGTH(whatsapp_digits) BETWEEN 10 AND 13
),
conversation_counts AS (
  SELECT
    c.contact_id,
    COUNT(*) AS conversations_count
  FROM conversations c
  GROUP BY c.contact_id
),
message_counts AS (
  SELECT
    c.contact_id,
    COUNT(cm.id) AS messages_count
  FROM conversations c
  LEFT JOIN conversation_messages cm
    ON cm.conversation_id = c.id
  GROUP BY c.contact_id
),
ranked AS (
  SELECT
    ec.*,
    COALESCE(cv.conversations_count, 0) AS conversations_count,
    COALESCE(mc.messages_count, 0) AS messages_count,
    ROW_NUMBER() OVER (
      PARTITION BY ec.tenant_id, ec.whatsapp_digits
      ORDER BY
        CASE WHEN ec.is_primary THEN 1 ELSE 0 END DESC,
        COALESCE(cv.conversations_count, 0) DESC,
        COALESCE(mc.messages_count, 0) DESC,
        ec.created_at ASC,
        ec.id ASC
    ) AS canonical_rank,
    COUNT(*) OVER (
      PARTITION BY ec.tenant_id, ec.whatsapp_digits
    ) AS duplicate_count
  FROM eligible_contacts ec
  LEFT JOIN conversation_counts cv
    ON cv.contact_id = ec.id::text
  LEFT JOIN message_counts mc
    ON mc.contact_id = ec.id::text
),
duplicate_groups AS (
  SELECT *
  FROM ranked
  WHERE duplicate_count > 1
),
winners AS (
  SELECT
    tenant_id,
    whatsapp_digits,
    id AS canonical_contact_id,
    client_id AS canonical_client_id,
    name AS canonical_name
  FROM duplicate_groups
  WHERE canonical_rank = 1
),
losers AS (
  SELECT
    tenant_id,
    whatsapp_digits,
    id AS duplicate_contact_id,
    client_id AS duplicate_client_id,
    name AS duplicate_name
  FROM duplicate_groups
  WHERE canonical_rank > 1
),
merge_map AS (
  SELECT
    l.tenant_id,
    l.whatsapp_digits,
    w.canonical_contact_id,
    w.canonical_client_id,
    w.canonical_name,
    l.duplicate_contact_id,
    l.duplicate_client_id,
    l.duplicate_name
  FROM losers l
  JOIN winners w
    ON w.tenant_id = l.tenant_id
   AND w.whatsapp_digits = l.whatsapp_digits
)
SELECT
  dg.tenant_id,
  dg.whatsapp_digits AS whatsapp_normalized,
  dg.duplicate_count,
  MAX(CASE WHEN dg.canonical_rank = 1 THEN dg.id::text END) AS canonical_contact_id,
  MAX(CASE WHEN dg.canonical_rank = 1 THEN dg.name END) AS canonical_name,
  MAX(CASE WHEN dg.canonical_rank = 1 THEN dg.client_id::text END) AS canonical_client_id,
  STRING_AGG(dg.id::text, ', ' ORDER BY dg.canonical_rank, dg.created_at, dg.id) AS grouped_contact_ids
FROM duplicate_groups dg
GROUP BY dg.tenant_id, dg.whatsapp_digits, dg.duplicate_count
ORDER BY dg.tenant_id, dg.whatsapp_digits;

WITH base_contacts AS (
  SELECT
    c.id,
    c.tenant_id,
    c.client_id,
    c.name,
    c.whatsapp,
    REGEXP_REPLACE(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g') AS whatsapp_digits,
    c.is_primary,
    c.status,
    c.created_at
  FROM contacts c
  WHERE c.whatsapp IS NOT NULL
    AND TRIM(c.whatsapp) <> ''
),
eligible_contacts AS (
  SELECT *
  FROM base_contacts
  WHERE status = 'active'
    AND whatsapp NOT LIKE '%@%'
    AND LENGTH(whatsapp_digits) BETWEEN 10 AND 13
),
conversation_counts AS (
  SELECT contact_id, COUNT(*) AS conversations_count
  FROM conversations
  GROUP BY contact_id
),
message_counts AS (
  SELECT c.contact_id, COUNT(cm.id) AS messages_count
  FROM conversations c
  LEFT JOIN conversation_messages cm
    ON cm.conversation_id = c.id
  GROUP BY c.contact_id
),
ranked AS (
  SELECT
    ec.*,
    COALESCE(cv.conversations_count, 0) AS conversations_count,
    COALESCE(mc.messages_count, 0) AS messages_count,
    ROW_NUMBER() OVER (
      PARTITION BY ec.tenant_id, ec.whatsapp_digits
      ORDER BY
        CASE WHEN ec.is_primary THEN 1 ELSE 0 END DESC,
        COALESCE(cv.conversations_count, 0) DESC,
        COALESCE(mc.messages_count, 0) DESC,
        ec.created_at ASC,
        ec.id ASC
    ) AS canonical_rank,
    COUNT(*) OVER (
      PARTITION BY ec.tenant_id, ec.whatsapp_digits
    ) AS duplicate_count
  FROM eligible_contacts ec
  LEFT JOIN conversation_counts cv
    ON cv.contact_id = ec.id::text
  LEFT JOIN message_counts mc
    ON mc.contact_id = ec.id::text
)
SELECT
  tenant_id,
  whatsapp_digits AS whatsapp_normalized,
  id AS contact_id,
  client_id,
  name,
  whatsapp,
  is_primary,
  conversations_count,
  messages_count,
  created_at,
  canonical_rank,
  CASE WHEN canonical_rank = 1 THEN 'KEEP' ELSE 'MERGE_CANDIDATE' END AS action
FROM ranked
WHERE duplicate_count > 1
ORDER BY tenant_id, whatsapp_digits, canonical_rank, created_at, id;

WITH base_contacts AS (
  SELECT
    c.id,
    c.tenant_id,
    c.client_id,
    c.name,
    c.whatsapp,
    REGEXP_REPLACE(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g') AS whatsapp_digits,
    c.is_primary,
    c.status,
    c.created_at
  FROM contacts c
  WHERE c.whatsapp IS NOT NULL
    AND TRIM(c.whatsapp) <> ''
),
eligible_contacts AS (
  SELECT *
  FROM base_contacts
  WHERE status = 'active'
    AND whatsapp NOT LIKE '%@%'
    AND LENGTH(whatsapp_digits) BETWEEN 10 AND 13
),
conversation_counts AS (
  SELECT contact_id, COUNT(*) AS conversations_count
  FROM conversations
  GROUP BY contact_id
),
message_counts AS (
  SELECT c.contact_id, COUNT(cm.id) AS messages_count
  FROM conversations c
  LEFT JOIN conversation_messages cm
    ON cm.conversation_id = c.id
  GROUP BY c.contact_id
),
ranked AS (
  SELECT
    ec.*,
    COALESCE(cv.conversations_count, 0) AS conversations_count,
    COALESCE(mc.messages_count, 0) AS messages_count,
    ROW_NUMBER() OVER (
      PARTITION BY ec.tenant_id, ec.whatsapp_digits
      ORDER BY
        CASE WHEN ec.is_primary THEN 1 ELSE 0 END DESC,
        COALESCE(cv.conversations_count, 0) DESC,
        COALESCE(mc.messages_count, 0) DESC,
        ec.created_at ASC,
        ec.id ASC
    ) AS canonical_rank
  FROM eligible_contacts ec
  LEFT JOIN conversation_counts cv
    ON cv.contact_id = ec.id::text
  LEFT JOIN message_counts mc
    ON mc.contact_id = ec.id::text
),
winners AS (
  SELECT tenant_id, whatsapp_digits, id AS canonical_contact_id
  FROM ranked
  WHERE canonical_rank = 1
),
losers AS (
  SELECT tenant_id, whatsapp_digits, id AS duplicate_contact_id
  FROM ranked
  WHERE canonical_rank > 1
),
merge_map AS (
  SELECT
    l.tenant_id,
    l.whatsapp_digits,
    w.canonical_contact_id,
    l.duplicate_contact_id
  FROM losers l
  JOIN winners w
    ON w.tenant_id = l.tenant_id
   AND w.whatsapp_digits = l.whatsapp_digits
)
SELECT
  mm.tenant_id,
  mm.whatsapp_digits AS whatsapp_normalized,
  mm.canonical_contact_id,
  mm.duplicate_contact_id
FROM merge_map mm
ORDER BY mm.tenant_id, mm.whatsapp_digits, mm.duplicate_contact_id;

WITH base_contacts AS (
  SELECT
    c.id,
    c.tenant_id,
    c.client_id,
    c.name,
    c.whatsapp,
    REGEXP_REPLACE(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g') AS whatsapp_digits,
    c.is_primary,
    c.status,
    c.created_at
  FROM contacts c
  WHERE c.whatsapp IS NOT NULL
    AND TRIM(c.whatsapp) <> ''
),
eligible_contacts AS (
  SELECT *
  FROM base_contacts
  WHERE status = 'active'
    AND whatsapp NOT LIKE '%@%'
    AND LENGTH(whatsapp_digits) BETWEEN 10 AND 13
),
conversation_counts AS (
  SELECT contact_id, COUNT(*) AS conversations_count
  FROM conversations
  GROUP BY contact_id
),
message_counts AS (
  SELECT c.contact_id, COUNT(cm.id) AS messages_count
  FROM conversations c
  LEFT JOIN conversation_messages cm
    ON cm.conversation_id = c.id
  GROUP BY c.contact_id
),
ranked AS (
  SELECT
    ec.*,
    COALESCE(cv.conversations_count, 0) AS conversations_count,
    COALESCE(mc.messages_count, 0) AS messages_count,
    ROW_NUMBER() OVER (
      PARTITION BY ec.tenant_id, ec.whatsapp_digits
      ORDER BY
        CASE WHEN ec.is_primary THEN 1 ELSE 0 END DESC,
        COALESCE(cv.conversations_count, 0) DESC,
        COALESCE(mc.messages_count, 0) DESC,
        ec.created_at ASC,
        ec.id ASC
    ) AS canonical_rank
  FROM eligible_contacts ec
  LEFT JOIN conversation_counts cv
    ON cv.contact_id = ec.id::text
  LEFT JOIN message_counts mc
    ON mc.contact_id = ec.id::text
),
winners AS (
  SELECT tenant_id, whatsapp_digits, id AS canonical_contact_id
  FROM ranked
  WHERE canonical_rank = 1
),
losers AS (
  SELECT tenant_id, whatsapp_digits, id AS duplicate_contact_id
  FROM ranked
  WHERE canonical_rank > 1
),
merge_map AS (
  SELECT
    l.tenant_id,
    l.whatsapp_digits,
    w.canonical_contact_id,
    l.duplicate_contact_id
  FROM losers l
  JOIN winners w
    ON w.tenant_id = l.tenant_id
   AND w.whatsapp_digits = l.whatsapp_digits
)
SELECT
  mm.tenant_id,
  mm.whatsapp_digits AS whatsapp_normalized,
  mm.canonical_contact_id,
  mm.duplicate_contact_id,
  COALESCE(conv.conversations_to_move, 0) AS conversations_contact_id,
  COALESCE(tic.tickets_to_move, 0) AS tickets_contact_id,
  COALESCE(cc.links_to_move, 0) AS contact_customers_contact_id
FROM merge_map mm
LEFT JOIN (
  SELECT contact_id, COUNT(*) AS conversations_to_move
  FROM conversations
  GROUP BY contact_id
) conv
  ON conv.contact_id = mm.duplicate_contact_id::text
LEFT JOIN (
  SELECT contact_id, COUNT(*) AS tickets_to_move
  FROM tickets
  WHERE contact_id IS NOT NULL
  GROUP BY contact_id
) tic
  ON tic.contact_id = mm.duplicate_contact_id::text
LEFT JOIN (
  SELECT contact_id, COUNT(*) AS links_to_move
  FROM contact_customers
  GROUP BY contact_id
) cc
  ON cc.contact_id = mm.duplicate_contact_id::text
ORDER BY mm.tenant_id, mm.whatsapp_digits, mm.duplicate_contact_id;

WITH base_contacts AS (
  SELECT
    c.id,
    c.tenant_id,
    c.whatsapp,
    REGEXP_REPLACE(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g') AS whatsapp_digits,
    c.is_primary,
    c.status,
    c.created_at
  FROM contacts c
  WHERE c.whatsapp IS NOT NULL
    AND TRIM(c.whatsapp) <> ''
),
eligible_contacts AS (
  SELECT *
  FROM base_contacts
  WHERE status = 'active'
    AND whatsapp NOT LIKE '%@%'
    AND LENGTH(whatsapp_digits) BETWEEN 10 AND 13
),
conversation_counts AS (
  SELECT contact_id, COUNT(*) AS conversations_count
  FROM conversations
  GROUP BY contact_id
),
message_counts AS (
  SELECT c.contact_id, COUNT(cm.id) AS messages_count
  FROM conversations c
  LEFT JOIN conversation_messages cm
    ON cm.conversation_id = c.id
  GROUP BY c.contact_id
),
ranked AS (
  SELECT
    ec.*,
    COALESCE(cv.conversations_count, 0) AS conversations_count,
    COALESCE(mc.messages_count, 0) AS messages_count,
    ROW_NUMBER() OVER (
      PARTITION BY ec.tenant_id, ec.whatsapp_digits
      ORDER BY
        CASE WHEN ec.is_primary THEN 1 ELSE 0 END DESC,
        COALESCE(cv.conversations_count, 0) DESC,
        COALESCE(mc.messages_count, 0) DESC,
        ec.created_at ASC,
        ec.id ASC
    ) AS canonical_rank
  FROM eligible_contacts ec
  LEFT JOIN conversation_counts cv
    ON cv.contact_id = ec.id::text
  LEFT JOIN message_counts mc
    ON mc.contact_id = ec.id::text
),
winners AS (
  SELECT tenant_id, whatsapp_digits, id AS canonical_contact_id
  FROM ranked
  WHERE canonical_rank = 1
),
losers AS (
  SELECT tenant_id, whatsapp_digits, id AS duplicate_contact_id
  FROM ranked
  WHERE canonical_rank > 1
),
merge_map AS (
  SELECT
    l.tenant_id,
    l.whatsapp_digits,
    w.canonical_contact_id,
    l.duplicate_contact_id
  FROM losers l
  JOIN winners w
    ON w.tenant_id = l.tenant_id
   AND w.whatsapp_digits = l.whatsapp_digits
)
SELECT
  COUNT(*) AS duplicate_contacts_to_merge,
  COUNT(DISTINCT tenant_id) AS impacted_tenants,
  COUNT(DISTINCT whatsapp_digits) AS impacted_whatsapp_numbers,
  COALESCE(SUM(conv.conversations_to_move), 0) AS total_conversations_contact_id,
  COALESCE(SUM(tic.tickets_to_move), 0) AS total_tickets_contact_id,
  COALESCE(SUM(cc.links_to_move), 0) AS total_contact_customers_contact_id
FROM merge_map mm
LEFT JOIN (
  SELECT contact_id, COUNT(*) AS conversations_to_move
  FROM conversations
  GROUP BY contact_id
) conv
  ON conv.contact_id = mm.duplicate_contact_id::text
LEFT JOIN (
  SELECT contact_id, COUNT(*) AS tickets_to_move
  FROM tickets
  WHERE contact_id IS NOT NULL
  GROUP BY contact_id
) tic
  ON tic.contact_id = mm.duplicate_contact_id::text
LEFT JOIN (
  SELECT contact_id, COUNT(*) AS links_to_move
  FROM contact_customers
  GROUP BY contact_id
) cc
  ON cc.contact_id = mm.duplicate_contact_id::text;

-- =========================================================
-- RELATORIO 2: auditoria (todos os status)
-- =========================================================

WITH base_contacts AS (
  SELECT
    c.id,
    c.tenant_id,
    c.client_id,
    c.name,
    c.whatsapp,
    REGEXP_REPLACE(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g') AS whatsapp_digits,
    c.is_primary,
    c.status,
    c.created_at
  FROM contacts c
  WHERE c.whatsapp IS NOT NULL
    AND TRIM(c.whatsapp) <> ''
),
auditable_contacts AS (
  SELECT *
  FROM base_contacts
  WHERE whatsapp NOT LIKE '%@%'
    AND LENGTH(whatsapp_digits) BETWEEN 10 AND 13
),
conversation_counts AS (
  SELECT contact_id, COUNT(*) AS conversations_count
  FROM conversations
  GROUP BY contact_id
),
message_counts AS (
  SELECT c.contact_id, COUNT(cm.id) AS messages_count
  FROM conversations c
  LEFT JOIN conversation_messages cm
    ON cm.conversation_id = c.id
  GROUP BY c.contact_id
),
ranked AS (
  SELECT
    ac.*,
    COALESCE(cv.conversations_count, 0) AS conversations_count,
    COALESCE(mc.messages_count, 0) AS messages_count,
    ROW_NUMBER() OVER (
      PARTITION BY ac.tenant_id, ac.whatsapp_digits
      ORDER BY
        CASE WHEN ac.is_primary THEN 1 ELSE 0 END DESC,
        COALESCE(cv.conversations_count, 0) DESC,
        COALESCE(mc.messages_count, 0) DESC,
        ac.created_at ASC,
        ac.id ASC
    ) AS canonical_rank,
    COUNT(*) OVER (
      PARTITION BY ac.tenant_id, ac.whatsapp_digits
    ) AS duplicate_count
  FROM auditable_contacts ac
  LEFT JOIN conversation_counts cv
    ON cv.contact_id = ac.id::text
  LEFT JOIN message_counts mc
    ON mc.contact_id = ac.id::text
)
SELECT
  tenant_id,
  whatsapp_digits AS whatsapp_normalized,
  id AS contact_id,
  client_id,
  name,
  whatsapp,
  status,
  is_primary,
  conversations_count,
  messages_count,
  created_at,
  canonical_rank,
  duplicate_count
FROM ranked
WHERE duplicate_count > 1
ORDER BY tenant_id, whatsapp_digits, canonical_rank, created_at, id;

WITH base_contacts AS (
  SELECT
    c.id,
    c.tenant_id,
    c.whatsapp,
    REGEXP_REPLACE(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g') AS whatsapp_digits,
    c.is_primary,
    c.status,
    c.created_at
  FROM contacts c
  WHERE c.whatsapp IS NOT NULL
    AND TRIM(c.whatsapp) <> ''
),
auditable_contacts AS (
  SELECT *
  FROM base_contacts
  WHERE whatsapp NOT LIKE '%@%'
    AND LENGTH(whatsapp_digits) BETWEEN 10 AND 13
),
conversation_counts AS (
  SELECT contact_id, COUNT(*) AS conversations_count
  FROM conversations
  GROUP BY contact_id
),
message_counts AS (
  SELECT c.contact_id, COUNT(cm.id) AS messages_count
  FROM conversations c
  LEFT JOIN conversation_messages cm
    ON cm.conversation_id = c.id
  GROUP BY c.contact_id
),
ranked AS (
  SELECT
    ac.*,
    COALESCE(cv.conversations_count, 0) AS conversations_count,
    COALESCE(mc.messages_count, 0) AS messages_count,
    ROW_NUMBER() OVER (
      PARTITION BY ac.tenant_id, ac.whatsapp_digits
      ORDER BY
        CASE WHEN ac.is_primary THEN 1 ELSE 0 END DESC,
        COALESCE(cv.conversations_count, 0) DESC,
        COALESCE(mc.messages_count, 0) DESC,
        ac.created_at ASC,
        ac.id ASC
    ) AS canonical_rank,
    COUNT(*) OVER (
      PARTITION BY ac.tenant_id, ac.whatsapp_digits
    ) AS duplicate_count
  FROM auditable_contacts ac
  LEFT JOIN conversation_counts cv
    ON cv.contact_id = ac.id::text
  LEFT JOIN message_counts mc
    ON mc.contact_id = ac.id::text
)
SELECT
  tenant_id,
  whatsapp_digits AS whatsapp_normalized,
  duplicate_count,
  COUNT(*) FILTER (WHERE status = 'active') AS active_contacts,
  COUNT(*) FILTER (WHERE status <> 'active') AS non_active_contacts
FROM ranked
WHERE duplicate_count > 1
GROUP BY tenant_id, whatsapp_digits, duplicate_count
ORDER BY tenant_id, whatsapp_digits;
