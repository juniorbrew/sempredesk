-- Migration 036 — FK: users.tenant_id → tenants(id)
-- Fase 3 (parcial) do PLANO_CORRECAO_BANCO.md
--
-- STATUS: PRONTA PARA REVISÃO — não aplicar sem leitura completa.
--
-- O que faz:
--   1. Converte users.tenant_id de character varying para uuid
--   2. Adiciona FK users.tenant_id → tenants(id) ON DELETE RESTRICT
--
-- O que NÃO faz:
--   - Não altera comportamento de autenticação (tenant_id vem do JWT, não desta coluna)
--   - Não torna tenant_id NOT NULL (coluna é nullable por design: super_admin pode não ter tenant)
--   - Não dropa índices existentes (PostgreSQL os reconstrói automaticamente no ALTER TYPE)
--
-- Dados verificados em 2026-04-18:
--   - 10 linhas na tabela users
--   - 0 valores NULL em tenant_id
--   - 0 valores fora do formato UUID
--   - 0 órfãos (todos os tenant_id existem em tenants)
--   - Índices existentes: idx_users_tenant_presence, idx_users_tenant_role_status
--     (ambos compostos com tenant_id — reconstruídos automaticamente pelo ALTER TYPE)
--
-- Janela de execução recomendada:
--   Horário de baixo tráfego. Com 10 linhas, o lock será de < 100ms.
--   Não requer manutenção planejada, mas é boa prática.
--
-- Rollback (reversão completa):
--   ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_tenant_id;
--   ALTER TABLE users ALTER COLUMN tenant_id TYPE character varying USING tenant_id::text;
--   -- Os índices serão reconstruídos automaticamente no rollback também.
--
-- Pré-requisito no backend (feito em 2026-04-18, antes da migration):
--   user.entity.ts linha 17 atualizada para:
--   @Column({ name: 'tenant_id', type: 'uuid', nullable: true }) tenantId: string;
--   Sem isso, `typeorm migration:generate` detectaria drift e reverteria o tipo para varchar.
--   Com synchronize=false (padrão) não há impacto em runtime — apenas consistência do schema.
--
-- Aplicação:
--   docker exec -i suporte_postgres psql -U suporte suporte_tecnico \
--     < infra/postgres/migrations/036_fk_users_tenant_id.sql

-- ══════════════════════════════════════════════════════
-- BLOCO 0 — PRÉ-CHECAGENS (rodar manualmente antes se quiser confirmar)
-- ══════════════════════════════════════════════════════
--
-- Confirmar que não há valores fora do formato UUID:
--   SELECT count(*) FROM users
--   WHERE tenant_id IS NOT NULL
--     AND tenant_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--   -- Deve retornar 0.
--
-- Confirmar que não há órfãos:
--   SELECT count(*) FROM users u
--   WHERE u.tenant_id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id::text = u.tenant_id);
--   -- Deve retornar 0.
--
-- Confirmar volume atual:
--   SELECT count(*) FROM users;
--   -- Deve ser próximo de 10 (verificar se não cresceu muito desde a auditoria).
--
-- Se qualquer checagem retornar valor > 0, NÃO aplicar esta migration.

-- ══════════════════════════════════════════════════════
-- BLOCO 1 — CONVERSÃO DE TIPO E FK (transacional)
-- ══════════════════════════════════════════════════════

BEGIN;

-- Passo 1: Converter tenant_id de varchar para uuid
-- USING tenant_id::uuid faz o cast de cada valor existente.
-- PostgreSQL reconstruirá automaticamente os índices que incluem tenant_id.
-- Lock: AccessExclusiveLock na tabela users durante a reescrita (< 100ms com 10 linhas).
ALTER TABLE users
  ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;

-- Passo 2: Adicionar FK para tenants(id)
-- ON DELETE RESTRICT: impede deletar um tenant que ainda tenha usuários vinculados.
-- A coluna permanece nullable — valores NULL não são verificados pela FK (design correto
-- para o caso do super_admin, que não pertence a nenhum tenant específico).
ALTER TABLE users
  ADD CONSTRAINT fk_users_tenant_id
  FOREIGN KEY (tenant_id)
  REFERENCES tenants(id)
  ON DELETE RESTRICT;

-- Passo 3: Comentário técnico
COMMENT ON COLUMN users.tenant_id IS
  'UUID do tenant ao qual o usuário pertence. NULL permitido para super_admin (role de plataforma). '
  'FK para tenants(id) ON DELETE RESTRICT desde migration 036 (2026-04-18).';

COMMIT;

-- ══════════════════════════════════════════════════════
-- BLOCO 2 — VALIDAÇÃO PÓS-APLICAÇÃO (rodar após o COMMIT)
-- ══════════════════════════════════════════════════════
--
-- 1. Confirmar tipo da coluna convertido:
--   SELECT column_name, data_type, udt_name, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name = 'tenant_id';
--   -- data_type deve ser 'uuid', is_nullable deve ser 'YES'.
--
-- 2. Confirmar FK criada:
--   SELECT conname, contype, confdeltype,
--          pg_get_constraintdef(oid) AS definition
--   FROM pg_constraint
--   WHERE conname = 'fk_users_tenant_id';
--   -- Deve retornar 1 linha com contype='f' e confdeltype='r' (RESTRICT).
--
-- 3. Confirmar índices reconstruídos (tipo agora deve ser uuid internamente):
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE tablename = 'users'
--     AND indexname IN ('idx_users_tenant_presence', 'idx_users_tenant_role_status');
--   -- Ambos devem existir.
--
-- 4. Smoke test — insert com tenant_id inválido deve ser bloqueado:
--   INSERT INTO users (id, name, email, password, role, tenant_id, status, created_at, updated_at)
--   VALUES (gen_random_uuid(), 'test', 'test@x.com', 'hash', 'admin',
--           '00000000-0000-0000-0000-000000000999', 'active', NOW(), NOW());
--   -- Deve retornar: ERROR: insert or update violates foreign key constraint "fk_users_tenant_id"
--
-- 5. Confirmar que dados existentes não foram alterados:
--   SELECT id, name, email, role, tenant_id FROM users ORDER BY created_at;
--   -- Todos os 10 usuários devem estar presentes com tenant_id correto.
