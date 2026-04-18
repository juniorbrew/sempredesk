-- Migration 032 — FKs seguras: tenant_licenses e tags → tenants
-- Fase 1 do PLANO_CORRECAO_BANCO.md
--
-- O que faz:
--   1. FK tenant_licenses.tenant_id → tenants.id  (ambos uuid, 0 órfãos confirmados)
--   2. FK tags.tenant_id → tenants.id             (ambos uuid, 0 órfãos confirmados)
--   3. Índice em tenant_settings(tenant_id)        (sem índice hoje, consultada por este campo)
--   4. Comentários técnicos nas tabelas principais
--
-- O que NÃO faz:
--   - Não altera tipos de coluna
--   - Não dropa nada
--   - Não toca nas 36 tabelas com tenant_id varchar (Fase 3/4)
--
-- Reversão:
--   ALTER TABLE tenant_licenses DROP CONSTRAINT IF EXISTS fk_tenant_licenses_tenant;
--   ALTER TABLE tags DROP CONSTRAINT IF EXISTS fk_tags_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_tenant_settings_tenant_id;
--
-- Verificação de integridade (rodar antes):
--   SELECT count(*) FROM tenant_licenses WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = tenant_licenses.tenant_id);
--   SELECT count(*) FROM tags WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = tags.tenant_id);
--   -- Ambos devem retornar 0.

BEGIN;

-- 1. FK: tenant_licenses.tenant_id → tenants.id
ALTER TABLE tenant_licenses
  ADD CONSTRAINT fk_tenant_licenses_tenant
  FOREIGN KEY (tenant_id)
  REFERENCES tenants(id)
  ON DELETE RESTRICT;  -- impede deletar tenant com licença ativa

-- 2. FK: tags.tenant_id → tenants.id
ALTER TABLE tags
  ADD CONSTRAINT fk_tags_tenant
  FOREIGN KEY (tenant_id)
  REFERENCES tenants(id)
  ON DELETE CASCADE;  -- tags são dados do tenant, removem junto

-- 3. Índice em tenant_settings(tenant_id) — faltava
CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant_id
  ON tenant_settings(tenant_id);

-- 4. Comentários técnicos para documentação no banco
COMMENT ON TABLE tenants IS
  'Raiz multi-tenant. id=uuid. tenant_id nas demais tabelas referencia este id. '
  'Fase 3/4 do PLANO_CORRECAO_BANCO.md migrará tenant_id varchar→uuid nas 36 tabelas restantes.';

COMMENT ON TABLE tenant_licenses IS
  'Licenças operacionais por tenant. tenant_id=uuid com FK para tenants(id) — único vínculo referencial formal com tenants hoje.';

COMMENT ON TABLE tenant_settings IS
  'Configurações de exibição e operação por tenant (company data, SMTP, SLA, cores). '
  'Fonte de verdade da UI interna. Sempre existe 1 registro por tenant após correção do onboarding (2026-04-18).';

COMMENT ON COLUMN tenant_settings.tenant_id IS
  'Referencia tenants.id (varchar por compatibilidade histórica — migrar para uuid na Fase 3).';

COMMIT;
