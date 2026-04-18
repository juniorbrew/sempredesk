-- Migration 037 — FK: conversations.contact_id → contacts(id)
-- Fase 3 (parcial) do PLANO_CORRECAO_BANCO.md
--
-- STATUS: PRONTA PARA REVISÃO — não aplicar sem leitura completa.
--
-- O que faz:
--   1. Converte conversations.contact_id de character varying para uuid
--   2. Adiciona FK conversations.contact_id → contacts(id) ON DELETE RESTRICT
--
-- O que NÃO faz:
--   - Não altera lógica da aplicação (contact_id vem do payload de criação da conversa)
--   - Não torna contact_id NULL (coluna já é NOT NULL por design)
--   - Não cria índice (já existe: idx_conversations_contact_id criado na migration 033)
--
-- Dados verificados em 2026-04-18 (migration 036 aplicada antes):
--   - 48 linhas na tabela conversations
--   - 0 valores NULL em contact_id (NOT NULL no schema)
--   - 0 valores fora do formato UUID
--   - 0 órfãos (todos os contact_id existem em contacts)
--   - Índice existente: idx_conversations_contact_id ON conversations(tenant_id, contact_id)
--     (reconstruído automaticamente pelo ALTER TYPE)
--
-- Decisão ON DELETE RESTRICT:
--   Um contato não pode ser deletado enquanto houver conversas vinculadas a ele.
--   Conversas são registros de negócio auditáveis — apagar cascata seria perigoso.
--   Para GDPR/anonimização: a aplicação deve encerrar/arquivar as conversas antes
--   de deletar o contato, ou implementar anonimização no nível da aplicação.
--
-- Janela de execução recomendada:
--   Horário de baixo tráfego. Com 48 linhas, o lock será de < 200ms.
--   Não requer manutenção planejada, mas é boa prática.
--
-- Rollback (reversão completa):
--   ALTER TABLE conversations DROP CONSTRAINT IF EXISTS fk_conversations_contact_id;
--   ALTER TABLE conversations ALTER COLUMN contact_id TYPE character varying USING contact_id::text;
--   -- O índice idx_conversations_contact_id será reconstruído automaticamente.
--
-- Pré-requisito no backend (feito antes da migration):
--   conversation.entity.ts linha 38 atualizada para:
--   @Column({ name: 'contact_id', type: 'uuid' }) contactId: string;
--   Mesmo motivo do users.entity.ts — evita que typeorm migration:generate detecte drift.
--
-- Aplicação:
--   docker exec -i suporte_postgres psql -U suporte suporte_tecnico \
--     < infra/postgres/migrations/037_fk_conversations_contact_id.sql

-- ══════════════════════════════════════════════════════
-- BLOCO 0 — PRÉ-CHECAGENS (rodar manualmente antes se quiser confirmar)
-- ══════════════════════════════════════════════════════
--
-- Confirmar que não há valores fora do formato UUID:
--   SELECT count(*) FROM conversations
--   WHERE contact_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--   -- Deve retornar 0.
--
-- Confirmar que não há órfãos:
--   SELECT count(*) FROM conversations c
--   WHERE NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.id::text = c.contact_id);
--   -- Deve retornar 0.
--
-- Confirmar volume atual:
--   SELECT count(*) FROM conversations;
--   -- Deve ser próximo de 48 (verificar se não cresceu muito desde a auditoria).
--
-- Se qualquer checagem retornar valor > 0, NÃO aplicar esta migration.

-- ══════════════════════════════════════════════════════
-- BLOCO 1 — CONVERSÃO DE TIPO E FK (transacional)
-- ══════════════════════════════════════════════════════

BEGIN;

-- Passo 1: Converter contact_id de varchar para uuid
-- USING contact_id::uuid faz o cast de cada valor existente.
-- PostgreSQL reconstruirá automaticamente o índice idx_conversations_contact_id.
-- Lock: AccessExclusiveLock na tabela conversations durante a reescrita (< 200ms com 48 linhas).
--
-- Nota sobre CHECK constraint existente (migration 033):
--   chk_conversations_contact_id_uuid_format foi armazenado pelo PostgreSQL com cast explícito já
--   resolvido: ((contact_id)::text ~ 'pattern'). Após ALTER TYPE, a expressão torna-se
--   (uuid_value)::text ~ 'pattern' — válido. O constraint permanece ativo e inofensivo
--   (redundante, pois a própria coluna uuid já rejeita valores mal formatados).
ALTER TABLE conversations
  ALTER COLUMN contact_id TYPE uuid USING contact_id::uuid;

-- Passo 2: Adicionar FK para contacts(id)
-- ON DELETE RESTRICT: impede deletar um contato que ainda tenha conversas vinculadas.
-- A coluna é NOT NULL — sem valores NULL, sem exceção de verificação.
ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_contact_id
  FOREIGN KEY (contact_id)
  REFERENCES contacts(id)
  ON DELETE RESTRICT;

-- Passo 3: Comentário técnico
COMMENT ON COLUMN conversations.contact_id IS
  'UUID do contato originador desta conversa. NOT NULL — toda conversa tem um contato. '
  'FK para contacts(id) ON DELETE RESTRICT desde migration 037 (2026-04-18). '
  'Para exclusão de contato com conversas, encerrar/arquivar antes ou anonimizar na aplicação.';

COMMIT;

-- ══════════════════════════════════════════════════════
-- BLOCO 2 — VALIDAÇÃO PÓS-APLICAÇÃO (rodar após o COMMIT)
-- ══════════════════════════════════════════════════════
--
-- 1. Confirmar tipo da coluna convertido:
--   SELECT column_name, data_type, udt_name, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'conversations' AND column_name = 'contact_id';
--   -- data_type deve ser 'uuid', is_nullable deve ser 'NO'.
--
-- 2. Confirmar FK criada:
--   SELECT conname, contype, confdeltype,
--          pg_get_constraintdef(oid) AS definition
--   FROM pg_constraint
--   WHERE conname = 'fk_conversations_contact_id';
--   -- Deve retornar 1 linha com contype='f' e confdeltype='r' (RESTRICT).
--
-- 3. Confirmar índice reconstruído:
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE tablename = 'conversations'
--     AND indexname = 'idx_conversations_contact_id';
--   -- Deve existir com tipo uuid internamente.
--
-- 4. Smoke test — insert com contact_id inválido deve ser bloqueado:
--   INSERT INTO conversations (id, tenant_id, contact_id, channel, status, created_at, updated_at)
--   VALUES (gen_random_uuid(),
--           (SELECT id FROM tenants LIMIT 1),
--           '00000000-0000-0000-0000-000000000999',
--           'whatsapp', 'active', NOW(), NOW());
--   -- Deve retornar: ERROR: insert or update violates foreign key constraint "fk_conversations_contact_id"
--
-- 5. Confirmar que dados existentes não foram alterados:
--   SELECT id, tenant_id, contact_id, channel, status FROM conversations ORDER BY created_at LIMIT 10;
--   -- Todas as 48 conversas devem estar presentes com contact_id correto.
