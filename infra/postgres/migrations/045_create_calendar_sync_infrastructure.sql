BEGIN;
CREATE TABLE calendar_sync_logs (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      VARCHAR     NOT NULL,
  integration_id UUID        NOT NULL,
  provider       VARCHAR(20) NOT NULL,
  direction      VARCHAR(10) NOT NULL,
  status         VARCHAR(20) NOT NULL,
  events_synced  INTEGER              DEFAULT 0,
  error_message  TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  CONSTRAINT pk_cal_sync_logs PRIMARY KEY (id),
  CONSTRAINT fk_cal_sync_integration FOREIGN KEY (integration_id) REFERENCES calendar_integrations(id) ON DELETE CASCADE,
  CONSTRAINT chk_cal_sync_direction  CHECK (direction IN ('inbound','outbound')),
  CONSTRAINT chk_cal_sync_status     CHECK (status    IN ('success','error','partial'))
);
CREATE INDEX idx_cal_sync_logs_integration ON calendar_sync_logs(integration_id);

CREATE TABLE calendar_webhook_subscriptions (
  id                       UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                VARCHAR     NOT NULL,
  integration_id           UUID        NOT NULL,
  provider                 VARCHAR(20) NOT NULL,
  provider_subscription_id VARCHAR(500),
  resource_uri             VARCHAR(500),
  expiration_at            TIMESTAMPTZ,
  status                   VARCHAR(20) NOT NULL DEFAULT 'active',
  last_notified_at         TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_cal_webhooks PRIMARY KEY (id),
  CONSTRAINT fk_cal_webhooks_integration FOREIGN KEY (integration_id) REFERENCES calendar_integrations(id) ON DELETE CASCADE,
  CONSTRAINT chk_cal_webhooks_status CHECK (status IN ('active','expired','cancelled'))
);
COMMENT ON TABLE calendar_webhook_subscriptions IS
  'Webhooks/subscriptions push para Google e Outlook (Fase 4).
   Google: canal HTTP com TTL máximo de 7 dias. Outlook: Microsoft Graph subscription, TTL máximo 3 dias.
   Requer renovação periódica via cron antes do expiration_at.';
COMMIT;
