#!/usr/bin/env bash
set -e

URL="${1:-https://suporte.financeos.com.br/api/monitoring/health}"

echo "Verificando $URL"
STATUS=$(curl -k -s -o /tmp/backend-health.out -w "%{http_code}" "$URL" || true)

if [ "$STATUS" != "200" ]; then
  echo "FALHA healthcheck HTTP=$STATUS"
  cat /tmp/backend-health.out 2>/dev/null || true
  exit 1
fi

echo "OK"
cat /tmp/backend-health.out
