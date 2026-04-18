# Plano de Correção do Banco — SempreDesk

**Data:** 2026-04-18  
**Prioridade:** conservador, menor diff, não quebrar produção

---

## Resumo Executivo

O banco tem **4 problemas estruturais** em ordem de severidade:

1. **tenant_id como varchar** em 36 tabelas (deveria ser uuid) — impede FKs
2. **Ausência de FK para tenants(id)** em todas as tabelas
3. **Sem RLS** — isolamento depende 100% da aplicação
4. **31 colunas `*_id` sem FK** dentro dos módulos

A correção completa exige uma migração de tipo em 36 tabelas — operação de alto risco que precisa de janela de manutenção. O plano divide isso em **4 fases** da mais segura para a mais invasiva.

---

## Fase 1 — SEGURA (pode aplicar agora) ✅

### O que faz
- Adiciona FKs nas 2 tabelas que já têm `tenant_id uuid` e dados íntegros
- Adiciona índice em `tenant_settings.tenant_id`
- Documenta o estado atual no banco via `COMMENT ON TABLE`

### Migrations
- `032_safe_fk_tenant_licenses_and_tags.sql`

### Risco
**Zero** — sem alteração de tipo, sem DROP, sem UPDATE. Apenas ADD CONSTRAINT e CREATE INDEX. Reversível com DROP CONSTRAINT / DROP INDEX.

### Pré-requisitos
- Verificar órfãos antes (script já executado: 0 órfãos confirmados)

---

## Fase 2 — BAIXO RISCO (após validação da Fase 1)

### O que faz
- Adiciona FKs dentro dos módulos onde ambos os lados são uuid e dados são íntegros
- `ticket_messages.ticket_id → tickets.id` (ambos uuid após cast — requer análise)
- `chatbot_sessions.contact_id → contacts.id`
- Adiciona CHECK CONSTRAINT para validar formato UUID em colunas tenant_id varchar

### Migrations
- `033_module_fks_safe.sql`

### Risco
**Baixo** — pode falhar se houver órfãos não detectados. Requer script de verificação antes.

### Pré-requisitos
- Script de verificação de órfãos para cada FK candidata
- Aprovação explícita após dry-run

---

## Fase 3 — MÉDIO RISCO (janela de manutenção curta)

### O que faz
- Migra `tenant_id` de `varchar` para `uuid` nas tabelas de menor volume
- Começa pelas tabelas sem dados: `api_keys`, `webhooks`, `root_causes`, `networks`, etc.
- Valida tipagem e adiciona FKs para `tenants(id)`

### Migrations
- `034_migrate_tenant_id_type_low_volume.sql`

### Risco
**Médio** — operação de ALTER COLUMN TYPE em tabelas vazias é rápida e segura; em tabelas com dados, requer LOCK e pode causar breve indisponibilidade.

### Pré-requisitos
- Backup verificado
- Janela de manutenção (< 5 min para tabelas vazias)
- Aprovação explícita

---

## Fase 4 — ALTO RISCO (planejamento cuidadoso)

### O que faz
- Migra `tenant_id` de `varchar` para `uuid` nas tabelas com dados: `tickets`, `conversations`, `ticket_messages`, `users`, etc.
- Adiciona RLS básico por tenant
- Remove `users_email_key` global e substitui por unique por tenant

### Estratégia recomendada
1. Adicionar coluna `tenant_uuid uuid` temporária
2. Preencher via `UPDATE ... SET tenant_uuid = tenant_id::uuid`
3. Verificar integridade
4. DROP coluna antiga, rename nova
5. Adicionar FK e índice
6. Ativar RLS

### Risco
**Alto** — locking em tabelas grandes (`ticket_messages` com 434 linhas, `tickets` com 49). Em produção com mais dados isso requer `pg_repack` ou zero-downtime migration.

### Pré-requisitos
- Fase 3 concluída
- Backup verificado
- Janela de manutenção planejada
- Aprovação explícita

---

## Mapa de Prioridades

| # | Ação | Fase | Risco | Aprovação necessária |
|---|------|------|-------|---------------------|
| 1 | FK: tenant_licenses → tenants | 1 | Zero | Não — aplicar agora |
| 2 | FK: tags → tenants | 1 | Zero | Não — aplicar agora |
| 3 | Índice: tenant_settings(tenant_id) | 1 | Zero | Não — aplicar agora |
| 4 | Comments nas tabelas principais | 1 | Zero | Não — aplicar agora |
| 5 | FK: ticket_messages.ticket_id | 2 | Baixo | Sim — após verificação |
| 6 | FK: chatbot_sessions → conversations | 2 | Baixo | Sim — após verificação |
| 7 | CHECK UUID format em varchar tenant_id | 2 | Baixo | Sim |
| 8 | Migrar tenant_id para uuid (sem dados) | 3 | Médio | Sim + manutenção |
| 9 | Migrar tenant_id para uuid (com dados) | 4 | Alto | Sim + manutenção |
| 10 | Ativar RLS por tenant | 4 | Alto | Sim + manutenção |
| 11 | Unique email por tenant | 4 | Alto | Sim + manutenção |

---

## O que já foi resolvido

| Problema | Quando | Como |
|----------|--------|------|
| tenant_settings vazio no onboarding | 2026-04-18 | TenantsOnboardService agora cria tenant_settings na transação |
| tenant_settings vazio em tenants antigos | 2026-04-18 | Script backfill-tenant-settings.js executado (3 tenants corrigidos) |
| Migrations de departmentId | 2026-04-17 | Migrations 20260417_department_id_columns e phase2 |
| FK: tenant_licenses → tenants(id) | 2026-04-18 | Migration 032 aplicada (ON DELETE RESTRICT) |
| FK: tags → tenants(id) | 2026-04-18 | Migration 032 aplicada (ON DELETE CASCADE) |
| Índice: tenant_settings(tenant_id) | 2026-04-18 | Migration 032 aplicada |
| CHECK UUID format: ticket_messages.ticket_id | 2026-04-18 | Migration 033 aplicada (NOT VALID) |
| CHECK UUID format: conversations.contact_id | 2026-04-18 | Migration 033 aplicada (NOT VALID) |
| CHECK UUID format: users.tenant_id | 2026-04-18 | Migration 033 aplicada (NOT VALID) |
| Índice: conversations(tenant_id, contact_id) | 2026-04-18 | Migration 033 aplicada |
| Órfão ticket_messages (id=5967a13b) | 2026-04-18 | Deletado — ticket b9d99593 nunca existiu corretamente (transação incompleta na criação; sem rastro em audit_logs, sem annexos, sem conversations; backup de 2026-04-18 preserva o estado anterior) |

---

## O que NÃO fazer sem aprovação

- DROP de qualquer coluna, índice ou constraint
- ALTER COLUMN TYPE em tabelas com dados
- UPDATE em massa sem dry-run primeiro
- Ativar RLS sem testes extensivos na aplicação
- Remover `users_email_key` sem análise de impacto no auth
