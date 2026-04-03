-- Migration 015: índices de performance para queries multi-tenant
--
-- ATENÇÃO: CREATE INDEX CONCURRENTLY não pode ser executado dentro de uma
-- transação. Correr este ficheiro fora de BEGIN/COMMIT, ou via psql directo.
--
-- Impacto em escrita: mínimo — índices B-tree em colunas de baixa cardinalidade
-- (role, status, presence_status) têm overhead pequeno em INSERT/UPDATE.
-- Impacto em leitura: elimina full table scans em queries de round-robin e
-- lookup de conversas por cliente.
--
-- Rollback: ver secção no final deste ficheiro.

-- ─── 1. conversations: lookup por client_id ───────────────────────────────
--
-- Cobre: findByClient(), getOrCreateForContact() (caso client_id IS NOT NULL)
-- Query típica: WHERE tenant_id = X AND client_id = Y ORDER BY last_message_at DESC NULLS LAST
-- Inclui last_message_at DESC para servir o ORDER BY directamente e evitar sort.
-- Não duplica idx_conversations_contact (tenant_id, contact_id, status).
--
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_client
    ON conversations (tenant_id, client_id, last_message_at DESC NULLS LAST)
    WHERE client_id IS NOT NULL;

-- ─── 2. users: elegibilidade de agentes por tenant ───────────────────────
--
-- Cobre: getNextAgent() — filtro de agentes activos com role técnico/admin/manager
-- Query típica: WHERE tenant_id = X AND role IN ('technician','admin','manager') AND status = 'active'
-- O índice existente idx_users_role cobre apenas (role), sem tenant_id —
-- com N tenants faz scan de todos os utilizadores do sistema.
-- Índice parcial WHERE status = 'active' exclui utilizadores inactivos (minoria).
--
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_tenant_role_status
    ON users (tenant_id, role, status)
    WHERE status = 'active';

-- ─── 3. users: presença online por tenant ────────────────────────────────
--
-- Cobre: getNextAgent() — agentes online; markOfflineByDbTimeout() por tenant
-- Query típica: WHERE tenant_id = X AND presence_status = 'online' AND last_seen_at > cutoff
-- O índice existente idx_users_presence_timeout cobre (presence_status, last_seen_at)
-- mas sem tenant_id — com N tenants, o Postgres lê TODOS os utilizadores online
-- de todos os tenants e filtra depois.
-- Este índice adiciona tenant_id como leading column; o filtro parcial
-- WHERE presence_status <> 'offline' mantém o índice leve.
-- O índice antigo (idx_users_presence_timeout) é mantido para a query do cron
-- markOfflineByDbTimeout que é cross-tenant.
--
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_tenant_presence
    ON users (tenant_id, presence_status, last_seen_at)
    WHERE presence_status IS NOT NULL AND presence_status <> 'offline';

-- ─── Rollback ─────────────────────────────────────────────────────────────
-- Para reverter, correr fora de transação:
--
--   DROP INDEX CONCURRENTLY IF EXISTS idx_conversations_client;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_users_tenant_role_status;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_users_tenant_presence;
--
-- Os índices originais (idx_conversations_contact, idx_users_role,
-- idx_users_presence_timeout) NÃO são alterados — rollback sem perda.
