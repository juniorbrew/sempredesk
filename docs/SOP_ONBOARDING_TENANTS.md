# SOP - Onboarding de Nova Empresa (Tenant)

## 1) Objetivo

Cadastrar uma nova empresa (tenant) no painel master e validar que ela esta pronta para uso com isolamento e licenca ativos.

## 2) Pre-requisitos

- Usuario com `role = super_admin`.
- Ambiente em producao saudavel:
  - `docker compose ps`
  - `curl -s http://localhost:4000/api/v1/health` retornando `status: ok`.
- Acesso ao painel:
  - `https://adminpanel.sempredesk.com.br/admin/tenants/new`

## 3) Procedimento de cadastro

1. Login em `https://adminpanel.sempredesk.com.br/auth/login` com `super_admin`.
2. Abrir `https://adminpanel.sempredesk.com.br/admin/tenants/new`.
3. Preencher:
   - Nome da empresa
   - Slug (unico, minusculo, sem espaco)
   - CNPJ (opcional)
   - E-mail / telefone
   - Plano
   - Nome/e-mail/senha do admin inicial
4. Clicar em **Criar empresa**.
5. Guardar os dados retornados:
   - `tenant.id`
   - `license.id`
   - `admin.email`

## 4) Validacao obrigatoria no banco (SQL)

Executar na VPS:

```bash
docker exec -i suporte_postgres psql -U suporte -d suporte_tecnico -c "SELECT id,name,slug,cnpj,plan,status FROM tenants ORDER BY created_at DESC LIMIT 5;"
docker exec -i suporte_postgres psql -U suporte -d suporte_tecnico -c "SELECT tenant_id,plan_slug,status,expires_at FROM tenant_licenses ORDER BY created_at DESC LIMIT 5;"
docker exec -i suporte_postgres psql -U suporte -d suporte_tecnico -c "SELECT id,email,role,tenant_id,status FROM users ORDER BY created_at DESC LIMIT 5;"
docker exec -i suporte_postgres psql -U suporte -d suporte_tecnico -c "SELECT action,entity_type,entity_id,user_type,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 10;"
```

### Criterio de aceite

- Tenant criado com `slug` correto.
- Licenca vinculada ao `tenant_id`.
- Admin criado com `tenant_id` da nova empresa.
- Logs de `TENANT_CREATED`, `LICENSE_CREATED`, `TENANT_ADMIN_CREATED`.

## 5) Validacao funcional

1. Logout do master.
2. Login com o admin da nova empresa em:
   - `https://suporte.sempredesk.com.br/auth/login`
3. Confirmar acesso ao dashboard sem erro de permissao.

## 6) Operacoes pos-cadastro

No painel de listagem (`/admin/tenants`):

- Buscar por nome/CNPJ/e-mail.
- Se necessario:
  - **Suspender/Reativar** tenant.
  - **Renovar** licenca (dias).

## 7) Troubleshooting rapido

- **403 no create tenant**: usuario logado nao e `super_admin`.
- **401 em varias APIs**: token expirado/subdominio errado; relogar.
- **Nao seguro no adminpanel**: revisar SSL do subdominio no Nginx/Certbot.
- **Deploy CI falhando**: confirmar deploy manual na VPS e aumentar timeout da action.

## 8) Governanca (obrigatorio)

- Nunca alterar producao so na VPS sem refletir no GitHub.
- Fluxo padrao: **LOCAL -> GitHub -> VPS**.
- Registrar internamente:
  - empresa criada,
  - responsavel,
  - data/hora,
  - plano e vencimento inicial da licenca.

