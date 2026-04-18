-- Migration 039 — FK: ticket_messages.ticket_id → tickets(id)
-- Etapa C de 3 para FK ticket_messages.ticket_id → tickets(id)
--
-- STATUS: PRONTA PARA REVISÃO — não aplicar sem leitura completa.
--
-- PRÉ-REQUISITOS OBRIGATÓRIOS (verificar antes de aplicar):
--   [✓] Migration 038 aplicada: idx_ticket_messages_ticket_id VALID
--   [✓] Backend atualizado e em produção:
--         tickets.service.ts:1167 — ticket_id::text = ANY($2::text[])
--         tickets.service.ts:1224 — ticket_id::text = ANY($2::text[])
--         ticket.entity.ts:180   — type: 'uuid' declarado
--       (Alterações já aplicadas no código em 2026-04-18 — requer deploy antes desta migration)
--
-- O que faz:
--   1. Converte ticket_messages.ticket_id de character varying para uuid
--   2. Adiciona FK ticket_messages.ticket_id → tickets(id) ON DELETE CASCADE
--
-- O que NÃO faz:
--   - Não altera tenant_id (ainda varchar — Fase 4 do plano)
--   - Não cria índice (já criado na migration 038)
--   - Não altera ticket_reply_attachments (tabela separada, não analisada nesta fase)
--
-- Dados verificados em 2026-04-18:
--   - 438 linhas em ticket_messages
--   - 0 valores NULL em ticket_id (NOT NULL no schema)
--   - 0 valores fora do formato UUID
--   - 0 órfãos (todos os ticket_id existem em tickets)
--   - Índice: idx_ticket_messages_ticket_id criado pela migration 038
--
-- Decisão ON DELETE CASCADE:
--   ticket_messages são filhos de tickets — não têm significado sem o pai.
--   CASCADE é semanticamente correto: deletar um ticket deleta suas mensagens.
--   RESTRICT seria problemático: exigiria apagar mensagens antes de cada ticket,
--   complicando qualquer fluxo de exclusão ou limpeza de tenant.
--   Evidência: settings.service.ts já deleta ticket_messages ANTES de tickets
--   no resetTestData — com CASCADE, essa ordem se torna apenas boa prática,
--   não obrigatória. Sem regressão.
--
-- Decisão sobre as queries do backend:
--   Duas queries usavam ticket_id = ANY($2::text[]) — padrão que quebra quando
--   a coluna muda de varchar para uuid (operator uuid = text não existe).
--   Foram corrigidas ANTES desta migration para ticket_id::text = ANY($2::text[])
--   — padrão backwards-compatible que funciona com varchar E com uuid.
--   As queries com parâmetro único (.andWhere 'ticket_id = :ticketId') já eram
--   seguras: TypeORM envia como OID 0 (untyped), PostgreSQL resolve para uuid.
--
-- Nota sobre CHECK constraint existente (migration 033):
--   chk_ticket_messages_ticket_id_uuid_format armazenado como:
--   ((ticket_id)::text ~ 'pattern'::text) NOT VALID
--   Após ALTER TYPE, a expressão torna-se (uuid_value)::text ~ 'pattern' — válido.
--   O constraint permanece ativo e se torna redundante (uuid já rejeita valores
--   mal formatados — a própria coluna passa a ser a guarda).
--
-- Janela de execução recomendada:
--   Horário de baixo tráfego. Com 438 linhas e o índice já existente,
--   o lock (AccessExclusiveLock) será de < 500ms. Não requer manutenção planejada.
--
-- Rollback:
--   ALTER TABLE ticket_messages DROP CONSTRAINT IF EXISTS fk_ticket_messages_ticket_id;
--   ALTER TABLE ticket_messages ALTER COLUMN ticket_id TYPE character varying USING ticket_id::text;
--   -- O índice idx_ticket_messages_ticket_id é reconstruído automaticamente no rollback.
--   -- As queries do backend (ticket_id::text = ANY($2::text[])) continuam funcionando
--   -- com varchar após rollback — o cast é inofensivo em ambas as direções.
--   -- O entity (type: 'uuid') NÃO precisa ser revertido: sem synchronize, não há
--   -- impacto em runtime; revert só se for rodar typeorm migration:generate.
--
-- Aplicação:
--   docker exec -i suporte_postgres psql -U suporte suporte_tecnico \
--     < infra/postgres/migrations/039_fk_ticket_messages_ticket_id.sql

-- ══════════════════════════════════════════════════════
-- BLOCO 0 — PRÉ-CHECAGENS (rodar manualmente antes se quiser confirmar)
-- ══════════════════════════════════════════════════════
--
-- 0a. Confirmar que migration 038 foi aplicada (índice VALID):
--   SELECT indexname,
--          CASE WHEN indisvalid THEN 'VALID' ELSE 'INVALID — aplicar 038 primeiro' END AS estado
--   FROM pg_indexes
--   JOIN pg_class ON pg_class.relname = indexname
--   JOIN pg_index ON pg_index.indexrelid = pg_class.oid
--   WHERE tablename = 'ticket_messages' AND indexname = 'idx_ticket_messages_ticket_id';
--   -- Deve retornar 1 linha com estado = 'VALID'. Se ausente, aplicar 038 primeiro.
--
-- 0b. Confirmar que não há valores fora do formato UUID:
--   SELECT count(*) FROM ticket_messages
--   WHERE ticket_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--   -- Deve retornar 0.
--
-- 0c. Confirmar que não há órfãos:
--   SELECT count(*) FROM ticket_messages tm
--   WHERE NOT EXISTS (SELECT 1 FROM tickets t WHERE t.id::text = tm.ticket_id);
--   -- Deve retornar 0.
--
-- 0d. Confirmar volume atual:
--   SELECT count(*) FROM ticket_messages;
--   -- Deve ser próximo de 438 (verificar crescimento desde a auditoria).
--
-- Se qualquer checagem 0b/0c retornar > 0, NÃO aplicar esta migration.

-- ══════════════════════════════════════════════════════
-- BLOCO 1 — CONVERSÃO DE TIPO E FK (transacional)
-- ══════════════════════════════════════════════════════

BEGIN;

-- Passo 1: Converter ticket_id de varchar para uuid
-- USING ticket_id::uuid faz o cast de cada valor existente.
-- PostgreSQL reconstruirá automaticamente idx_ticket_messages_ticket_id.
-- Lock: AccessExclusiveLock na tabela ticket_messages (< 500ms com 438 linhas + índice pronto).
ALTER TABLE ticket_messages
  ALTER COLUMN ticket_id TYPE uuid USING ticket_id::uuid;

-- Passo 2: Adicionar FK para tickets(id)
-- ON DELETE CASCADE: mensagens são filhos de tickets; deletar o ticket deleta suas mensagens.
-- A coluna é NOT NULL — sem valores NULL, sem exceção de verificação da FK.
ALTER TABLE ticket_messages
  ADD CONSTRAINT fk_ticket_messages_ticket_id
  FOREIGN KEY (ticket_id)
  REFERENCES tickets(id)
  ON DELETE CASCADE;

-- Passo 3: Comentário técnico
COMMENT ON COLUMN ticket_messages.ticket_id IS
  'UUID do ticket ao qual esta mensagem pertence. NOT NULL — toda mensagem tem um ticket. '
  'FK para tickets(id) ON DELETE CASCADE desde migration 039 (2026-04-18): '
  'apagar o ticket apaga automaticamente todas as suas mensagens.';

COMMIT;

-- ══════════════════════════════════════════════════════
-- BLOCO 2 — VALIDAÇÃO PÓS-APLICAÇÃO (rodar após o COMMIT)
-- ══════════════════════════════════════════════════════
--
-- 1. Confirmar tipo da coluna convertido:
--   SELECT column_name, data_type, udt_name, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'ticket_messages' AND column_name = 'ticket_id';
--   -- data_type deve ser 'uuid', is_nullable deve ser 'NO'.
--
-- 2. Confirmar FK criada:
--   SELECT conname, contype, confdeltype,
--          pg_get_constraintdef(oid) AS definition
--   FROM pg_constraint
--   WHERE conname = 'fk_ticket_messages_ticket_id';
--   -- Deve retornar 1 linha com contype='f' e confdeltype='a' (CASCADE).
--
-- 3. Confirmar índice reconstruído e válido:
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE tablename = 'ticket_messages'
--     AND indexname = 'idx_ticket_messages_ticket_id';
--   -- Deve existir.
--
-- 4. Smoke test — insert com ticket_id inválido deve ser bloqueado:
--   INSERT INTO ticket_messages
--     (id, tenant_id, ticket_id, author_id, author_type, author_name, "messageType", content, created_at)
--   VALUES (
--     gen_random_uuid(),
--     (SELECT tenant_id FROM tickets LIMIT 1),
--     '00000000-0000-0000-0000-000000000999',
--     NULL, 'user', 'Teste', 'comment', 'teste fk', NOW()
--   );
--   -- Deve retornar: ERROR: insert or update violates foreign key constraint "fk_ticket_messages_ticket_id"
--
-- 5. Confirmar que dados existentes não foram alterados:
--   SELECT id, ticket_id, author_type, content FROM ticket_messages ORDER BY created_at LIMIT 5;
--   -- As mensagens devem estar presentes com ticket_id correto.
--
-- 6. Confirmar que as queries do backend ainda funcionam (rodar via API):
--   GET /tickets?includeLastMessage=true  (exercita a query linha 1167)
--   GET /tickets/portal (exercita a query linha 1224)
--   GET /tickets/:id/messages (exercita .andWhere — linha 2310/2331)
