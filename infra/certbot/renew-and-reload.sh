#!/usr/bin/env sh
# Rodar no HOST da VPS (cron), a partir do diretório do projeto — ex.: /opt/suporte-tecnico
set -e
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
cd "$REPO_ROOT"
docker compose run --rm certbot renew
docker compose exec nginx nginx -s reload
