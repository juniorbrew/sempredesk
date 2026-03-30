-- Limpeza de sujeira em contacts.whatsapp antes do indice unico.
-- Objetivo:
-- 1. Remover identificadores tecnicos (LID/JID) do campo whatsapp/phone.
-- 2. Preservar esses identificadores em metadata.whatsappLid.
-- 3. Remover whatsapp/phone dos duplicados inativos de numeros reais.
-- 4. Permitir criacao segura do indice unico por tenant + whatsapp.

-- Auditoria antes
SELECT
  id,
  tenant_id,
  name,
  whatsapp,
  phone,
  status,
  is_primary,
  metadata
FROM contacts
WHERE (
  whatsapp IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(whatsapp, '[^0-9]', '', 'g')) >= 14
)
OR id IN (
  SELECT c.id
  FROM contacts c
  JOIN (
    SELECT tenant_id, whatsapp
    FROM contacts
    WHERE whatsapp IS NOT NULL
    GROUP BY tenant_id, whatsapp
    HAVING COUNT(*) > 1
  ) dup
    ON dup.tenant_id = c.tenant_id
   AND dup.whatsapp = c.whatsapp
)
ORDER BY created_at, id;

BEGIN;

-- 1. Identificadores tecnicos: tirar do campo whatsapp/phone e manter em metadata.whatsappLid
UPDATE contacts c
SET
  metadata = jsonb_set(
    COALESCE(c.metadata, '{}'::jsonb),
    '{whatsappLid}',
    to_jsonb(REGEXP_REPLACE(c.whatsapp, '[^0-9]', '', 'g')),
    true
  ),
  whatsapp = NULL,
  phone = CASE
    WHEN c.phone IS NOT NULL
      AND REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(c.whatsapp, '[^0-9]', '', 'g')
    THEN NULL
    ELSE c.phone
  END
WHERE c.whatsapp IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(c.whatsapp, '[^0-9]', '', 'g')) >= 14;

-- 2. Duplicados inativos de numeros reais: limpar whatsapp/phone nos registros inativos
WITH duplicated_real_whatsapp AS (
  SELECT tenant_id, whatsapp
  FROM contacts
  WHERE whatsapp IS NOT NULL
    AND LENGTH(REGEXP_REPLACE(whatsapp, '[^0-9]', '', 'g')) BETWEEN 10 AND 13
  GROUP BY tenant_id, whatsapp
  HAVING COUNT(*) > 1
)
UPDATE contacts c
SET
  whatsapp = NULL,
  phone = CASE
    WHEN c.phone IS NOT NULL
      AND REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(c.whatsapp, '[^0-9]', '', 'g')
    THEN NULL
    ELSE c.phone
  END
FROM duplicated_real_whatsapp d
WHERE c.tenant_id = d.tenant_id
  AND c.whatsapp = d.whatsapp
  AND c.status = 'inactive';

COMMIT;

-- Auditoria depois
SELECT
  id,
  tenant_id,
  name,
  whatsapp,
  phone,
  status,
  is_primary,
  metadata
FROM contacts
WHERE (
  metadata ? 'whatsappLid'
  OR whatsapp = '5573999272550'
  OR whatsapp = '131245778460786'
  OR whatsapp = '126809077219420'
  OR whatsapp = '557381168008'
)
ORDER BY created_at, id;

SELECT
  tenant_id::text,
  whatsapp,
  COUNT(*) AS duplicate_count
FROM contacts
WHERE whatsapp IS NOT NULL
GROUP BY tenant_id::text, whatsapp
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, tenant_id::text, whatsapp;
