# Inventário do Banco de Dados — SempreDesk

**Gerado em:** 2026-04-18  
**Banco:** suporte_tecnico (PostgreSQL 15-alpine)  
**Container:** suporte_postgres  
**Backup de referência:** `/opt/suporte-tecnico/backups/suporte_tecnico_20260418_021611.sql.gz` (302 KB)

---

## 1. Extensões Instaladas

| Extensão | Versão |
|----------|--------|
| plpgsql  | 1.0    |
| uuid-ossp | 1.1   |
| pg_trgm  | 1.6    |

---

## 2. Tabelas (44 total)

| Tabela | Tamanho | Colunas | Linhas (~) |
|--------|---------|---------|-----------|
| ticket_messages | 272 kB | 11 | 434 |
| agent_attendance | 112 kB | 18 | 251 |
| conversation_messages | 192 kB | 15 | 199 |
| conversations | 208 kB | 27 | 48 |
| tickets | 160 kB | 40 | 49 |
| agent_departments | 120 kB | 6 | 46 |
| clients | 760 kB | 29 | 0 |
| contacts | 496 kB | 17 | 6 |
| users | 80 kB | 19 | 10 |
| tenant_priorities | 96 kB | 10 | 8 |
| pause_reasons | 64 kB | 10 | 10 |
| chatbot_sessions | 64 kB | 12 | 19 |
| tenant_settings | 32 kB | 29 | 1 |
| tenant_licenses | 64 kB | 12 | 1 |
| tenants | 64 kB | 12 | 3 |
| sla_policies | 80 kB | 9 | 5 |
| distribution_queues | 112 kB | 6 | 9 |
| whatsapp_connections | 96 kB | 14 | 1 |
| chatbot_configs | 32 kB | 28 | 1 |
| chatbot_menu_items | 48 kB | 10 | 5 |
| agent_pause_requests | 80 kB | 19 | 12 |
| audit_logs | 96 kB | 9 | 3 |
| contact_customers | 48 kB | 6 | 1 |
| routing_rules | 24 kB | 15 | 0 |
| kb_articles | 16 kB | 13 | 0 |
| kb_categories | 16 kB | 8 | 0 |
| networks | 80 kB | 11 | 0 |
| contracts | 32 kB | 18 | 0 |
| ticket_reply_attachments | 112 kB | 9 | 0 |
| ticket_settings | 48 kB | 11 | 0 |
| permissions | 40 kB | 6 | 0 |
| roles | 40 kB | 5 | 0 |
| role_permissions | 56 kB | 2 | 0 |
| api_keys | 24 kB | 9 | 0 |
| webhooks | 16 kB | 11 | 0 |
| tags | 24 kB | 8 | 0 |
| root_causes | 32 kB | 7 | 0 |
| devices | 48 kB | 16 | 0 |
| device_events | 32 kB | 9 | 0 |
| device_metrics | 24 kB | 7 | 0 |
| team_chat_messages | 32 kB | 8 | 0 |
| internal_chat_messages | 32 kB | 7 | 0 |
| chatbot_widget_messages | 16 kB | 7 | 0 |
| typeorm_migrations | 32 kB | 3 | 0 |

---

## 3. Foreign Keys Existentes (21)

| Tabela origem | Coluna | Tabela destino | Coluna |
|---------------|--------|----------------|--------|
| agent_departments | department_id | ticket_settings | id |
| agent_pause_requests | reason_id | pause_reasons | id |
| chatbot_menu_items | department_id | ticket_settings | id |
| chatbot_menu_items | chatbot_id | chatbot_configs | id |
| chatbot_sessions | whatsapp_channel_id | whatsapp_connections | id |
| contacts | client_id | clients | id |
| conversation_messages | conversation_id | conversations | id |
| conversation_messages | reply_to_id | conversation_messages | id |
| conversations | whatsapp_channel_id | whatsapp_connections | id |
| conversations | chatbot_department_id | ticket_settings | id |
| conversations | priority_id | tenant_priorities | id |
| conversations | sla_policy_id | sla_policies | id |
| distribution_queues | department_id | ticket_settings | id |
| role_permissions | role_id | roles | id |
| role_permissions | permission_id | permissions | id |
| routing_rules | cond_department_id | ticket_settings | id |
| tenant_priorities | sla_policy_id | sla_policies | id |
| ticket_reply_attachments | ticket_message_id | ticket_messages | id |
| ticket_settings | default_priority_id | tenant_priorities | id |
| tickets | priority_id | tenant_priorities | id |
| tickets | department_id | ticket_settings | id |

**Ausência crítica:** nenhuma tabela tem FK para `tenants(id)`.

---

## 4. Inconsistências de Tipo — tenant_id

A coluna `tenant_id` é do tipo **`character varying`** em 36 tabelas e **`uuid`** em 2:

| Tabela | Tipo de tenant_id | Anomalia |
|--------|------------------|---------|
| tenant_licenses | **uuid** | ⚠️ diferente do padrão |
| tags | **uuid** | ⚠️ diferente do padrão |
| todas as outras (36) | character varying | padrão atual |

O campo `tenants.id` é `uuid`. A inconsistência varchar ↔ uuid:
- Impede criação de FK declarativa na maioria das tabelas
- Força casts explícitos em joins (`t.id::text = ts.tenant_id`)
- Permite inserção de strings inválidas como tenant_id (sem validação de formato)

---

## 5. Colunas `*_id` sem FK Declarada

### Críticas (alta probabilidade de dados cruzados sem validação)

| Tabela | Coluna | Tipo | Referência provável |
|--------|--------|------|---------------------|
| agent_attendance | user_id | varchar | users(id) |
| agent_attendance | tenant_id | varchar | tenants(id) |
| agent_departments | user_id | varchar | users(id) |
| chatbot_sessions | contact_id | varchar | contacts(id) |
| chatbot_sessions | conversation_id | varchar | conversations(id) |
| chatbot_widget_messages | session_id | varchar | chatbot_sessions(id) |
| contact_customers | client_id | varchar | clients(id) |
| contact_customers | contact_id | varchar | contacts(id) |
| contracts | client_id | varchar | clients(id) |
| conversation_messages | author_id | varchar | users(id) |
| conversations | contact_id | varchar | contacts(id) |
| conversations | client_id | varchar | clients(id) |
| conversations | ticket_id | varchar | tickets(id) |
| devices | client_id | varchar | clients(id) |
| device_events | device_id | varchar | devices(id) |
| device_events | ticket_id | varchar | tickets(id) |
| internal_chat_messages | sender_id | varchar | users(id) |
| internal_chat_messages | recipient_id | varchar | users(id) |
| kb_articles | author_id | varchar | users(id) |
| kb_articles | category_id | varchar | kb_categories(id) |
| kb_categories | parent_id | varchar | kb_categories(id) |
| networks | tenant_id | varchar | tenants(id) |
| team_chat_messages | author_id | varchar | users(id) |
| ticket_messages | ticket_id | varchar | tickets(id) |
| ticket_messages | author_id | varchar | users(id) |
| ticket_reply_attachments | ticket_id | varchar | tickets(id) |
| tickets | client_id | varchar | tickets→clients |
| tickets | contact_id | varchar | contacts(id) |
| tickets | contract_id | varchar | contracts(id) |
| tickets | conversation_id | varchar | conversations(id) |
| users | tenant_id | varchar | tenants(id) |

### Seguras para FK imediata (ambas uuid, dados íntegros verificados)

| Tabela | Coluna | Tipo | FK para | Órfãos |
|--------|--------|------|---------|--------|
| tenant_licenses | tenant_id | uuid | tenants(id) | 0 |
| tags | tenant_id | uuid | tenants(id) | 0 |

---

## 6. Tabelas com tenant_id (isolamento multi-tenant)

38 tabelas possuem `tenant_id`. Tabelas sem `tenant_id` (dados globais ou de sistema):

| Tabela | Justificativa |
|--------|---------------|
| permissions | dados globais do sistema |
| roles | dados globais do sistema |
| role_permissions | dados globais do sistema |
| typeorm_migrations | controle interno |

---

## 7. Índices Relevantes (resumo)

- **tenant_id indexado:** a maioria das tabelas tem índice em tenant_id combinado com outros campos
- **Ausência notável:** `tenant_settings` não tem índice em `tenant_id` (única por tenant, mas sem índice)
- **Partial indexes:** uso extenso e correto de partial indexes para status e campos nullable

---

## 8. Migrations Existentes (36 arquivos)

| Arquivo | Status |
|---------|--------|
| 001 → 019, 021 → 031 (numerados) | aplicados |
| 20260402, 20260412, 20260413, 20260416, 20260417_* | aplicados |
| README.md | documentação |

**Gap:** migrations 020 ausente (pulou de 019 para 021).
