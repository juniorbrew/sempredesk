#!/usr/bin/env bash
# Smoke mínimo: health da API. Uso na VPS ou local (Git Bash / Linux / macOS).
#   BASE_URL=http://127.0.0.1:4000 bash scripts/smoke-public.sh
#   BASE_URL=https://suporte.sempredesk.com.br bash scripts/smoke-public.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4000}"
BASE_URL="${BASE_URL%/}"
URL="${BASE_URL}/api/v1/health"

echo "→ GET ${URL}"
body="$(curl -sS -f --max-time 25 "$URL")" || {
  echo "ERRO: falha ao obter resposta HTTP 2xx de ${URL}"
  exit 1
}

if ! echo "$body" | grep -q '"status"'; then
  echo "ERRO: corpo inesperado (esperado JSON com status):"
  echo "$body"
  exit 1
fi

if ! echo "$body" | grep -q 'ok'; then
  echo "ERRO: status diferente de ok no JSON:"
  echo "$body"
  exit 1
fi

echo "OK — health respondeu com status ok"
