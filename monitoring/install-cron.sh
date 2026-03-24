#!/usr/bin/env bash
set -e

CRON_LINE="*/5 * * * * /opt/suporte-tecnico/monitoring/check-backend.sh >> /opt/suporte-tecnico/logs/healthcheck.log 2>&1"

(
  crontab -l 2>/dev/null | grep -v "monitoring/check-backend.sh"
  echo "$CRON_LINE"
) | crontab -

echo "cron instalado"
crontab -l
