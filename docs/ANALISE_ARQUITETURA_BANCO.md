# Análise de Arquitetura do Banco — SempreDesk

**Data:** 2026-04-18  
**Versão PostgreSQL:** 15-alpine  
**Banco:** suporte_tecnico | **Tabelas:** 44 | **FKs:** 21

---

## 1. Visão Geral da Arquitetura

O banco adota um modelo **multi-tenant de schema compartilhado** onde o isolamento entre tenants é feito exclusivamente pela coluna `tenant_id` presente em 38 das 44 tabelas. Não há schemas separados por tenant nem Row-Level Security ativo.

```
tenants (raiz)
  ├── users          (tenant_id varchar)
  ├── tenant_settings (tenant_id varchar)
  ├── tenant_licenses (tenant_id UUID)  ← tipo diferente!
  ├── tickets         (tenant_id varchar)
  │     ├── ticket_messages
  │     └── ticket_reply_attachments
  ├── conversations   (tenant_id varchar)
  │     └── conversation_messages
  ├── contacts / clients / contracts
  ├── chatbot_configs / chatbot_sessions / chatbot_menu_items
  ├── sla_policies / tenant_priorities
  ├── ticket_settings (departamentos)
  │     ├── agent_departments
  │     ├── distribution_queues
  │     └── routing_rules
  └── [+ 20 tabelas operacionais]
```

---

## 2. Pontos Fortes

| # | Ponto | Detalhe |
|---|-------|---------|
| 1 | **tenant_id presente em 38 tabelas** | Cobertura quase total — isolamento lógico está implementado |
| 2 | **Partial indexes extensos** | Uso correto de `WHERE dept IS NOT NULL`, `WHERE status='active'`, etc. Economiza espaço e melhora queries |
| 3 | **Transações no onboarding** | `TenantsOnboardService.onboard()` usa transação TypeORM — garantia atômica |
| 4 | **Auditoria implementada** | Tabela `audit_logs` com índices em action, entity e user |
| 5 | **pg_trgm instalado** | Suporte a busca textual eficiente (LIKE, similaridade) |
| 6 | **Unique constraints estratégicos** | `uq_agent_dept`, `uq_dist_queue`, `uq_pause_reason_tenant_name` evitam duplicatas |
| 7 | **Migrations sequenciais** | Histórico rastreável de evolução do schema |
| 8 | **Backup automático possível** | pg_dump funciona normalmente com o container atual |

---

## 3. Riscos por Severidade

### 🔴 ALTO

#### 3.1 Ausência total de FK para `tenants(id)`
**Impacto:** Nenhuma tabela tem FK declarada para a tabela `tenants`. Um tenant pode ser deletado do banco e todos os seus dados relacionados ficam órfãos silenciosamente, sem nenhuma proteção referencial.

**Tabelas afetadas:** todas as 38 com tenant_id.  
**Causa raiz:** 36 tabelas usam `varchar` para tenant_id enquanto `tenants.id` é `uuid` — FK declarativa é impossível sem cast ou migração de tipo.

#### 3.2 Inconsistência de tipo em tenant_id (varchar vs uuid)
**Impacto:** `tenant_id` é `varchar` em 36 tabelas e `uuid` em 2 (`tenant_licenses`, `tags`). O campo `tenants.id` é `uuid`.

Consequências:
- Impossibilidade de FK na maioria das tabelas
- Joins exigem `::text` cast (impede uso de índices em alguns casos)
- Nenhuma validação de formato UUID no banco — um valor `"abc"` pode ser inserido como tenant_id
- Risco de divergência silenciosa entre tenants

#### 3.3 Sem Row-Level Security (RLS)
**Impacto:** O isolamento entre tenants depende 100% da aplicação (`WHERE tenant_id = $1`). Se um bug ou injection bypassa esse filtro, dados de todos os tenants ficam expostos numa única query.

**Superfície de risco:** qualquer endpoint que não use corretamente `req.tenantId` do middleware.

---

### 🟡 MÉDIO

#### 3.4 Colunas `*_id` sem FK (31 colunas identificadas)
Referências entre tabelas sem constraint declarado. Exemplos críticos:
- `conversations.contact_id → contacts(id)` — sem FK
- `ticket_messages.ticket_id → tickets(id)` — sem FK
- `chatbot_sessions.conversation_id → conversations(id)` — sem FK
- `users.tenant_id → tenants(id)` — sem FK

**Risco:** deleção de registro pai deixa referências órfãs sem notificação.

#### 3.5 tenant_settings sem índice em tenant_id
A tabela `tenant_settings` não tem índice na coluna `tenant_id`, apesar de ser consultada por ela em todo carregamento do painel. Com 3 tenants atuais o impacto é zero, mas o índice é obrigatório antes de crescer.

#### 3.6 Gap na numeração de migrations (020 ausente)
A migration 020 não existe — pula de 019 para 021. Pode causar confusão em auditorias futuras, especialmente com ferramentas que validam sequência.

#### 3.7 `contact_customers` usa varchar para client_id/contact_id
A tabela ponte `contact_customers` tem `client_id` e `contact_id` como varchar, mas as tabelas referenciadas (`clients`, `contacts`) têm `id` como uuid. Joins implícitos funcionam hoje, mas são frágeis.

---

### 🟢 BAIXO

#### 3.8 `tags.tenant_id` é uuid (anomalia isolada)
Única tabela operacional com `tenant_id uuid`. Não causa problema imediato (sem dados), mas é inconsistência que vai confundir futuras migrations.

#### 3.9 Dupla geração de UUID
Algumas tabelas usam `uuid_generate_v4()` (extensão `uuid-ossp`) e outras usam `gen_random_uuid()` (nativo PostgreSQL 13+). Funcionalmente equivalentes, mas inconsistente.

#### 3.10 `users.email` com UNIQUE global
`users_email_key` é único globalmente — não é por tenant. Se dois tenants tiverem usuário com o mesmo email, o segundo falhará no insert. Em multi-tenant isso pode ser um problema, dependendo da estratégia de usuários compartilhados.

---

## 4. Avaliação do Modelo Multi-Tenant

| Critério | Avaliação | Nota |
|----------|-----------|------|
| Cobertura de tenant_id | Quase total (38/44 tabelas) | ✅ |
| Isolamento no banco | Fraco — só filtros de aplicação | ⚠️ |
| FK para tenants | Inexistente | ❌ |
| Tipagem consistente | Inconsistente (varchar vs uuid) | ⚠️ |
| RLS ativo | Não | ⚠️ |
| Índices de tenant | Bom (compostos em 90%+ das tabelas) | ✅ |
| Validação de formato | Inexistente no banco | ❌ |

**Conclusão:** isolamento funcional hoje, mas tecnicamente frágil. Depende 100% da correção da aplicação, sem camada de segurança no banco.

---

## 5. Avaliação de Integridade Referencial

**21 FKs existentes** — bem focadas dentro dos módulos (departamentos, prioridades, SLA, permissions). **Zero FKs** cruzam a fronteira multi-tenant (`→ tenants`).

Principais caminhos sem proteção:
```
users ──────────────→ tenants          (sem FK)
ticket_messages ────→ tickets          (sem FK)
chatbot_sessions ───→ conversations    (sem FK)
conversations ──────→ contacts         (sem FK)
tickets ────────────→ clients          (sem FK)
```

---

## 6. Avaliação de Segurança Operacional

| Área | Status | Observação |
|------|--------|-----------|
| JWT + tenant_id no payload | ✅ Implementado | TenantMiddleware extrai e injeta corretamente |
| Validação de licença | ✅ Implementado | TenantLicenseInterceptor bloqueia tenants expirados |
| Auditoria de ações | ✅ Implementado | audit_logs cobre criação de tenants e usuários |
| RLS no banco | ❌ Ausente | Isolamento depende só da aplicação |
| Validação UUID no banco | ❌ Ausente | varchar aceita qualquer string como tenant_id |
| FK para integridade referencial | ❌ Mínima | 0 FKs para tenants |
| Backup automatizado | ⚠️ Manual | Nenhum job agendado identificado |
