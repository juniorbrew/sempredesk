-- 013_tenants_cnpj.sql

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cnpj VARCHAR(18);

CREATE INDEX IF NOT EXISTS tenants_cnpj_idx
  ON tenants (cnpj);

