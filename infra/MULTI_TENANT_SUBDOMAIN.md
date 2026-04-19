# SempreDesk — Multi-Tenant por Subdomínio

## Visão geral

Cada empresa (tenant) pode acessar o sistema pelo seu próprio subdomínio:

```
empresa1.sempredesk.com.br → painel da Empresa 1
empresa2.sempredesk.com.br → painel da Empresa 2
demo.sempredesk.com.br     → painel de demonstração
```

O sistema também suporta **domínios customizados**:
```
painel.minhaempresa.com.br → tenant com campo custom_domain preenchido
```

---

## Arquitetura implementada

### 1. Banco de dados (migração 047)
```sql
-- /infra/postgres/migrations/047_tenant_custom_domain.sql
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS custom_domain    VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS subdomain_active BOOLEAN NOT NULL DEFAULT true;
```

### 2. Backend — resolução de host
O endpoint `GET /api/v1/tenants/by-host` resolve qual tenant está associado ao host da requisição:
- Lê o header `X-Forwarded-Host` (propagado pelo Nginx)
- Verifica `custom_domain` na tabela tenants
- Se não encontrar, extrai o subdomínio e busca pelo `slug`
- Subdomínios do sistema (`suporte`, `cliente`, `adminpanel`, `www`, `api`, `app`, `mail`) retornam 404

```
GET /api/v1/tenants/by-host
Header: X-Forwarded-Host: empresa1.sempredesk.com.br

→ 200 { id, name, slug, customDomain }
→ 404 se subdomínio não corresponder a nenhum tenant
```

### 3. Backend — CORS dinâmico
`main.ts` aceita automaticamente qualquer `*.sempredesk.com.br` sem precisar atualizar variáveis:

```typescript
// Regex aceita *.baseDomain
const wildcardPattern = /^https?:\/\/([\w-]+\.)*sempredesk\.com\.br(:\d+)?$/;
```

Variável `BASE_DOMAIN=sempredesk.com.br` em `backend/.env` e `docker-compose.yml`.

### 4. Frontend — login por host
`/auth/login` detecta automaticamente o tenant pelo hostname:
- Extrai subdomínio de `window.location.hostname`
- Faz `GET /api/v1/tenants/by-subdomain/:slug` para exibir badge da empresa
- Envia `tenantSlug` no body do login para validar vínculo do usuário

### 5. OAuth — redirect por subdomínio
Ao iniciar OAuth (`GET /calendar/integrations/:provider/connect-url`):
- O backend captura `X-Forwarded-Host` da requisição
- Inclui `returnHost` no state HMAC-assinado
- Após autorização, o callback redireciona para `https://{returnHost}/...`
- `isSafeReturnHost()` valida que o host pertence ao `BASE_DOMAIN` antes de redirecionar

---

## Variáveis de ambiente necessárias

### `backend/.env`
```env
BASE_DOMAIN=sempredesk.com.br
APP_FRONTEND_URL=https://suporte.sempredesk.com.br   # fallback se returnHost inválido
```

### `docker-compose.yml` (seção backend > environment)
```yaml
BASE_DOMAIN: sempredesk.com.br
```

---

## Infraestrutura (Nginx + DNS + SSL)

### DNS
Configure um registro wildcard no seu provedor de DNS:

```
*.sempredesk.com.br   A   77.237.236.230   TTL 3600
```

Isso cobre todos os subdomínios existentes e futuros automaticamente.

### SSL (Wildcard)
O certificado wildcard já está configurado em:
```
/etc/letsencrypt/live/sempredesk.com.br/fullchain.pem
/etc/letsencrypt/live/sempredesk.com.br/privkey.pem
```

Para renovar (requer DNS challenge com plugin do provedor):
```bash
certbot renew --dns-<seu-plugin>
```

### Nginx
O `nginx.conf` já possui bloco `server_name *.sempredesk.com.br` com wildcard SSL.
O header `X-Forwarded-Host` é propagado automaticamente pelo bloco existente.

**Não é necessária nenhuma alteração no Nginx para adicionar um novo tenant.**

---

## Onboarding de nova empresa (runbook)

### Passo 1 — Criar o tenant no banco

Via painel admin (`/admin/tenants`) ou diretamente via API (super admin):

```bash
POST /api/v1/admin/tenants
Authorization: Bearer <super-admin-token>

{
  "name": "Empresa Exemplo",
  "slug": "exemplo",         # será o subdomínio: exemplo.sempredesk.com.br
  "email": "contato@exemplo.com",
  "plan": "professional"
}
```

O campo `slug` deve conter apenas letras minúsculas, números e hifens, sem pontos.
Slugs reservados (não usar): `suporte`, `cliente`, `adminpanel`, `www`, `api`, `app`, `mail`.

### Passo 2 — Criar o usuário admin da empresa

```bash
POST /api/v1/admin/tenants/:tenantId/users
{
  "name": "Admin Empresa",
  "email": "admin@exemplo.com",
  "password": "SenhaForte@123",
  "role": "admin"
}
```

### Passo 3 — Testar o acesso

```bash
# Verificar resolução de subdomínio
curl https://suporte.sempredesk.com.br/api/v1/tenants/by-host \
  -H "X-Forwarded-Host: exemplo.sempredesk.com.br"

# Deve retornar: { id, name, slug: "exemplo", customDomain: null }
```

### Passo 4 — Informar o cliente

Enviar ao cliente:
```
URL de acesso: https://exemplo.sempredesk.com.br
Login: admin@exemplo.com
Senha provisória: (a definida no passo 2)
```

O login detecta automaticamente o tenant pelo subdomínio — sem necessidade de parâmetros adicionais.

---

## Domínio customizado (opcional)

Para empresas que queiram usar seu próprio domínio (ex.: `painel.cliente.com.br`):

### 1. Coletar o CNAME do cliente

O cliente deve criar no DNS deles:
```
painel.cliente.com.br   CNAME   empresa.sempredesk.com.br
```

### 2. Registrar no banco

```sql
UPDATE tenants
SET custom_domain = 'painel.cliente.com.br'
WHERE slug = 'empresa';
```

Ou via API admin (quando endpoint for adicionado):
```bash
PATCH /api/v1/admin/tenants/:tenantId
{ "customDomain": "painel.cliente.com.br" }
```

### 3. Obter certificado SSL para o domínio customizado

```bash
certbot certonly --nginx -d painel.cliente.com.br
```

### 4. Adicionar bloco Nginx para o domínio customizado

```nginx
server {
  listen 443 ssl http2;
  server_name painel.cliente.com.br;

  ssl_certificate     /etc/letsencrypt/live/painel.cliente.com.br/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/painel.cliente.com.br/privkey.pem;

  # Igual ao bloco wildcard existente
  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header Host $host;
  }
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header Host $host;
  }
}
```

**Nota:** Para domínios customizados, SSL e Nginx precisam ser configurados manualmente.

---

## Validação do ambiente

```bash
# 1. CORS wildcard
curl -sI -X OPTIONS \
  -H "Origin: https://novocliente.sempredesk.com.br" \
  -H "Access-Control-Request-Method: GET" \
  http://localhost:4000/api/v1/tenants/by-host \
  | grep Access-Control-Allow-Origin
# Esperado: Access-Control-Allow-Origin: https://novocliente.sempredesk.com.br

# 2. Resolução de host
curl -s \
  -H "X-Forwarded-Host: demo.sempredesk.com.br" \
  http://localhost:4000/api/v1/tenants/by-host | jq .data.slug
# Esperado: "demo"

# 3. Subdomínio de sistema bloqueado
curl -sI \
  -H "X-Forwarded-Host: suporte.sempredesk.com.br" \
  http://localhost:4000/api/v1/tenants/by-host | head -1
# Esperado: HTTP/1.1 404 Not Found
```

---

## Resumo das alterações (implementação)

| Arquivo | Alteração |
|---|---|
| `infra/postgres/migrations/047_tenant_custom_domain.sql` | Adiciona `custom_domain` e `subdomain_active` à tabela `tenants` |
| `backend/src/modules/tenants/tenant.entity.ts` | Mapeia as duas novas colunas |
| `backend/src/modules/tenants/tenants.service.ts` | Adiciona `findByHost()` |
| `backend/src/modules/tenants/tenants.controller.ts` | Adiciona `GET /tenants/by-host` |
| `backend/src/modules/tenants/tenants.module.ts` | Importa `ConfigModule` |
| `backend/src/main.ts` | CORS dinâmico com regex `*.baseDomain` |
| `backend/src/modules/calendar/integrations/calendar-integrations.service.ts` | `buildAuthUrl` recebe `returnHost`; `isSafeReturnHost()`; `resolveFrontendUrlFromState()` |
| `backend/src/modules/calendar/integrations/calendar-integrations.controller.ts` | `GET /:provider/connect-url`; captura `X-Forwarded-Host`; error paths usam `resolveFrontendUrlFromState()` |
| `frontend/src/app/auth/login/page.tsx` | Auto-detecta tenant do hostname; envia `tenantSlug` no login |
| `backend/.env` | Adiciona `BASE_DOMAIN=sempredesk.com.br` |
| `docker-compose.yml` | Adiciona `BASE_DOMAIN: sempredesk.com.br` ao env do backend |
