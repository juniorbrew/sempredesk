#!/bin/bash
# Renova certificados SSL (rode via cron semanalmente)
# Exemplo cron: 0 3 * * 0 /opt/suporte-tecnico/scripts/renew-ssl.sh >> /var/log/certbot-renew.log 2>&1

set -e
cd "$(dirname "$0")/.."

docker compose run --rm certbot renew --webroot -w /var/www/certbot --quiet
docker exec suporte_nginx nginx -s reload 2>/dev/null || true
