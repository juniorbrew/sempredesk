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
- **Cliente ou equipa presos numa pagina "Acesso indisponivel" / `license-blocked`**: ver secao 8.

## 8) Licenca expirada ou tenant suspenso (suporte ao cliente)

**Runbook rápido (checklist + macros):** [RUNBOOK_BLOQUEIO_LICENCA.md](./RUNBOOK_BLOQUEIO_LICENCA.md)

### 8.1 O que o utilizador ve

- **Painel da equipa** (`suporte.*`): ao usar o sistema, o browser pode ir para `/license-blocked?from=staff&reason=...`.
- **Portal do cliente** (`cliente.*`): mesmo fluxo com `from=portal` na URL.
- A mensagem em `reason` vem da API (ex.: licenca expirada, empresa suspensa).

### 8.2 O que verificar (interno)

1. No painel master (`super_admin`): **Empresas** → localizar tenant → ver **status** e **data de fim da licenca**.
2. No banco (se precisar de detalhe):

```bash
docker exec -i suporte_postgres psql -U suporte -d suporte_tecnico -c "SELECT id,name,slug,status,email FROM tenants WHERE slug = 'SLUG_DA_EMPRESA';"
docker exec -i suporte_postgres psql -U suporte -d suporte_tecnico -c "SELECT tenant_id,status,plan_slug,expires_at FROM tenant_licenses WHERE tenant_id = 'UUID_DO_TENANT' ORDER BY created_at DESC LIMIT 3;"
```

### 8.3 Correcao habitual

| Situacao | Accao no master |
|----------|-----------------|
| Trial ou licenca a expirar | **Renovar licenca** (dias) em `/admin/tenants` |
| Empresa suspensa indevidamente | **Reativar** |
| Licenca activa mas datas erradas | Renovar ou corrigir dados com acordo interno (evitar SQL directo sem revisao) |

Depois de corrigir, pedir ao cliente/equipa para **voltar a fazer login** (sessao antiga pode continuar invalida ate renovar).

### 8.4 Lembretes de trial (e-mail)

- Job diario (backend) envia avisos para trial com SMTP da plataforma (`SAAS_SMTP_*` no `.env`).
- Se nao houver `SAAS_SMTP_HOST`, os lembretes nao sao enviados (so log).
- Destinatario: primeiro usuario **admin** do tenant; senao e-mail da empresa no cadastro do tenant.

### 8.5 Texto sugerido para o cliente (adaptar)

> A empresa esta temporariamente sem acesso ao portal/painel porque a licenca de avaliacao expirou ou a conta foi suspensa. Ja regularizamos / vamos regularizar em ate [prazo]. Apos a renovacao, aceda de novo ao login e, se a pagina de bloqueio aparecer, use o botao para limpar a sessao e entrar outra vez.

### 8.6 Auditoria

- Accoes de suspensao, renovacao e onboarding ficam em **Auditoria** (`/admin/audit-logs`) e na tabela `audit_logs`.

## 9) Governanca (obrigatorio)

- Nunca alterar producao so na VPS sem refletir no GitHub.
- Fluxo padrao: **LOCAL -> GitHub -> VPS**.
- Registrar internamente:
  - empresa criada,
  - responsavel,
  - data/hora,
  - plano e vencimento inicial da licenca.

