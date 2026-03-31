-- 011_tenant_licenses.sql

CREATE TABLE IF NOT EXISTS tenant_licenses (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID        NOT NULL,
  plan_slug         VARCHAR(50) NOT NULL,
  status            VARCHAR(30) NOT NULL DEFAULT 'trial',
  billing_cycle     VARCHAR(30) NOT NULL DEFAULT 'monthly',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  extra_limits      JSONB       NOT NULL DEFAULT '{}',
  meta              JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_licenses_tenant_idx
  ON tenant_licenses (tenant_id);

CREATE INDEX IF NOT EXISTS tenant_licenses_status_idx
  ON tenant_licenses (status);

