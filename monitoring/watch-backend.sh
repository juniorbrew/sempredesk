#!/usr/bin/env bash
set -u

URL="${1:-https://suporte.sempredesk.com.br/api/monitoring/health}"
LOG="/opt/suporte-tecnico/logs/backend-watch.log"

mkdir -p /opt/suporte-tecnico/logs

while true; do
  TS=$(date '+%Y-%m-%d %H:%M:%S')
  STATUS=$(curl -k -s -o /tmp/backend-watch.out -w "%{http_code}" "$URL" || true)

  if [ "$STATUS" = "200" ]; then
    echo "[$TS] OK health=$STATUS" >> "$LOG"
  else
    echo "[$TS] FAIL health=$STATUS" >> "$LOG"
  fi

  sleep 60
done
