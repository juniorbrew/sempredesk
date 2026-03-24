-- Migration 003: histórico de métricas de dispositivos
-- Armazena séries temporais de CPU, memória e disco por dispositivo

CREATE TABLE IF NOT EXISTS device_metrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  device_id   UUID NOT NULL,
  cpu         NUMERIC(5,2),
  memory      NUMERIC(5,2),
  disk        NUMERIC(10,2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_metrics_lookup
  ON device_metrics (tenant_id, device_id, recorded_at DESC);

-- Limpeza automática: manter apenas 30 dias de histórico
-- (executar via cron ou pg_cron se disponível)
-- DELETE FROM device_metrics WHERE recorded_at < NOW() - INTERVAL '30 days';
