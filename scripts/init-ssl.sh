#!/bin/bash
# Obtém certificados SSL (Let's Encrypt) para suporte.sempredesk.com.br e cliente.sempredesk.com.br
# Pré-requisitos: DNS apontando para este servidor nas portas 80 e 443

set -e
cd "$(dirname "$0")/.."

EMAIL="${SSL_EMAIL:-}"
if [ -z "$EMAIL" ]; then
  echo "Defina seu e-mail para o Let's Encrypt:"
  echo "  export SSL_EMAIL=seu@email.com"
  echo "  ./scripts/init-ssl.sh"
  exit 1
fi

echo "=== 1. Usando config HTTP (para validação ACME) ==="
cp infra/nginx/nginx-http-only.conf infra/nginx/nginx.conf

echo "=== 2. Reiniciando Nginx ==="
docker compose up -d nginx
sleep 3

echo "=== 3. Obtendo certificados Let's Encrypt ==="
docker compose run --rm certbot certonly \
  --webroot \
  -w /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d suporte.sempredesk.com.br \
  -d cliente.sempredesk.com.br

echo "=== 4. Ativando config HTTPS ==="
cp infra/nginx/nginx-ssl.conf infra/nginx/nginx.conf

echo "=== 5. Reiniciando Nginx com SSL ==="
docker compose restart nginx

echo ""
echo "✓ HTTPS configurado com sucesso!"
echo "  https://suporte.sempredesk.com.br"
echo "  https://cliente.sempredesk.com.br"
echo ""
echo "Para renovação automática, inicie o serviço certbot:"
echo "  docker compose up -d certbot"
