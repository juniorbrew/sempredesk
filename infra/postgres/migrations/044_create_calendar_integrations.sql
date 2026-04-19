BEGIN;
CREATE TABLE calendar_integrations (
  id                     UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id              VARCHAR     NOT NULL,
  user_id                UUID        NOT NULL,
  provider               VARCHAR(20) NOT NULL,
  provider_account       VARCHAR(255),
  -- tokens stored encrypted (AES-256 via CALENDAR_TOKEN_SECRET env) — never plain text in prod
  access_token_enc       TEXT,
  refresh_token_enc      TEXT,
  token_expires_at       TIMESTAMPTZ,
  provider_calendar_id   VARCHAR(500),
  provider_calendar_name VARCHAR(255),
  sync_token             TEXT,
  last_synced_at         TIMESTAMPTZ,
  sync_enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
  status                 VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_cal_integrations PRIMARY KEY (id),
  CONSTRAINT uq_cal_integration_user_provider UNIQUE (tenant_id, user_id, provider),
  CONSTRAINT fk_cal_integrations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_cal_integrations_provider CHECK (provider IN ('google','outlook')),
  CONSTRAINT chk_cal_integrations_status   CHECK (status   IN ('active','expired','revoked','error'))
);
CREATE INDEX idx_cal_integrations_tenant_user ON calendar_integrations(tenant_id, user_id);
COMMENT ON TABLE calendar_integrations IS
  'Tokens OAuth por usuário por tenant para Google Calendar e Microsoft Outlook (Fase 4).
   access_token_enc e refresh_token_enc devem ser encriptados com AES-256 antes de persistir.
   Requer env: CALENDAR_TOKEN_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET.';
COMMIT;
