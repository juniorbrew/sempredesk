-- 012_audit_logs.sql

CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action        VARCHAR(100)  NOT NULL,
  user_id       VARCHAR(100)  NOT NULL,
  user_email    VARCHAR(200),
  user_type     VARCHAR(50)   NOT NULL,
  entity_type   VARCHAR(100)  NOT NULL,
  entity_id     VARCHAR(100)  NOT NULL,
  details       JSONB         NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_action_idx
  ON audit_logs (action);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON audit_logs (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS audit_logs_user_idx
  ON audit_logs (user_type, user_id);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON audit_logs (created_at);

