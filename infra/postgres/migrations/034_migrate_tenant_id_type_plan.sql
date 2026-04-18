-- Migration 034 — Plano de migração tenant_id varchar→uuid (PENDENTE APROVAÇÃO)
-- Fase 3 do PLANO_CORRECAO_BANCO.md
--
-- STATUS: PLANEJAMENTO — NÃO EXECUTAR sem aprovação e janela de manutenção.
--
-- Contexto:
--   36 tabelas têm tenant_id como character varying.
--   tenants.id é uuid. Isso impede FKs e validação de formato.
--   Esta migration trata APENAS as tabelas sem dados (volume zero no inventário de 2026-04-18).
--   Tabelas com dados (tickets, conversations, users, etc.) — ver Fase 4.
--
-- Tabelas alvo desta migration (todas sem dados em 2026-04-18):
--   api_keys, webhooks, root_causes, networks, routing_rules,
--   kb_articles, kb_categories, devices, device_events,
--   team_chat_messages, internal_chat_messages, chatbot_widget_messages
--
-- Estratégia (segura para tabelas vazias):
--   ALTER COLUMN TYPE usando USING tenant_id::uuid
--   Sem dados = lock instantâneo, sem risco de timeout.
--
-- Pré-requisitos:
--   1. Backup verificado
--   2. Confirmar que tabelas ainda estão vazias:
--      SELECT table_name, n_live_tup FROM pg_stat_user_tables
--      WHERE relname IN ('api_keys','webhooks','root_causes','networks',
--        'routing_rules','kb_articles','kb_categories','devices',
--        'device_events','team_chat_messages','internal_chat_messages',
--        'chatbot_widget_messages')
--      ORDER BY n_live_tup DESC;
--      -- Todas devem ter n_live_tup = 0.

BEGIN;

ALTER TABLE api_keys          ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE webhooks          ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE root_causes       ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE networks          ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE routing_rules     ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE kb_articles       ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE kb_categories     ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE devices           ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE device_events     ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE team_chat_messages   ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE internal_chat_messages ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;
ALTER TABLE chatbot_widget_messages ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;

-- FKs imediatas após migração de tipo
ALTER TABLE api_keys          ADD CONSTRAINT fk_api_keys_tenant          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE webhooks          ADD CONSTRAINT fk_webhooks_tenant           FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE root_causes       ADD CONSTRAINT fk_root_causes_tenant        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE networks          ADD CONSTRAINT fk_networks_tenant           FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE routing_rules     ADD CONSTRAINT fk_routing_rules_tenant      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE kb_articles       ADD CONSTRAINT fk_kb_articles_tenant        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE kb_categories     ADD CONSTRAINT fk_kb_categories_tenant      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE devices           ADD CONSTRAINT fk_devices_tenant            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE device_events     ADD CONSTRAINT fk_device_events_tenant      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE team_chat_messages    ADD CONSTRAINT fk_team_chat_messages_tenant    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE internal_chat_messages ADD CONSTRAINT fk_internal_chat_messages_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE chatbot_widget_messages ADD CONSTRAINT fk_chatbot_widget_messages_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

COMMIT;
