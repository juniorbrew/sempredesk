-- Migration 007: Agent Presence DB fields
-- Adiciona colunas de presença persistida ao usuário para:
--   1. Fallback de presença via HTTP heartbeat (PATCH /agents/me/status, POST /agents/me/heartbeat)
--   2. Detecção de timeout por cron (last_seen_at > 5 min → offline)
--   3. Complemento ao Redis (WebSocket); as duas fontes são unidas em getNextAgent()
--
-- Uso de ADD COLUMN IF NOT EXISTS: seguro para re-execução e compatível com dados existentes.
-- Nullable: zero breaking changes em registros anteriores.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS presence_status VARCHAR(20) DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS last_seen_at    TIMESTAMPTZ;

-- Índice para acelerar a query do cron de timeout:
--   SELECT id, tenant_id FROM users WHERE presence_status != 'offline' AND last_seen_at < $1
CREATE INDEX IF NOT EXISTS idx_users_presence_timeout
  ON users (presence_status, last_seen_at)
  WHERE presence_status IS NOT NULL AND presence_status != 'offline';
