-- ================================================================
-- SempreDesk — Schema Canônico v2.0
-- Gerado em 2026-03-27 a partir do schema real do banco de produção.
-- Substitui o init.sql v1.0 que havia ficado desatualizado em relação
-- às entidades TypeORM e às migrations 001-009 aplicadas ao longo do tempo.
--
-- Uso: este arquivo roda somente em inicializações de banco zerado
-- (Docker entrypoint / fresh deploy). Em bancos existentes, as
-- migrations individuais em infra/postgres/migrations/ devem ser usadas.
-- ================================================================

-- ── EXTENSÕES ─────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── TIPOS ENUM ────────────────────────────────────────────────
CREATE TYPE contracts_contract_type_enum AS ENUM (
  'hours_bank', 'monthly', 'on_demand', 'warranty'
);
CREATE TYPE contracts_status_enum AS ENUM (
  'active', 'expired', 'cancelled', 'suspended'
);
CREATE TYPE conversations_channel_enum AS ENUM (
  'portal', 'whatsapp'
);
CREATE TYPE conversations_initiated_by_enum AS ENUM (
  'contact', 'agent'
);
CREATE TYPE conversations_status_enum AS ENUM (
  'active', 'closed'
);
CREATE TYPE devices_device_type_enum AS ENUM (
  'pdv', 'server', 'printer', 'router', 'other'
);
CREATE TYPE devices_status_enum AS ENUM (
  'online', 'offline', 'warning', 'unknown'
);
CREATE TYPE ticket_messages_messagetype_enum AS ENUM (
  'comment', 'internal', 'status_change', 'system'
);
CREATE TYPE ticket_settings_type_enum AS ENUM (
  'department', 'category', 'subcategory'
);
CREATE TYPE tickets_origin_enum AS ENUM (
  'portal', 'email', 'whatsapp', 'phone', 'internal'
);
CREATE TYPE tickets_priority_enum AS ENUM (
  'low', 'medium', 'high', 'critical'
);
CREATE TYPE tickets_status_enum AS ENUM (
  'open', 'in_progress', 'waiting_client', 'resolved', 'closed', 'cancelled'
);
CREATE TYPE whatsapp_connections_provider_enum AS ENUM (
  'baileys', 'meta'
);
CREATE TYPE whatsapp_connections_status_enum AS ENUM (
  'disconnected', 'connecting', 'connected'
);

-- ── TENANTS ───────────────────────────────────────────────────
CREATE TABLE tenants (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(200) NOT NULL,
  slug       VARCHAR(100) UNIQUE NOT NULL,
  cnpj       VARCHAR(18),
  plan       VARCHAR(30)  NOT NULL DEFAULT 'starter',
  status     VARCHAR(30)  NOT NULL DEFAULT 'trial',
  email      VARCHAR(200),
  phone      VARCHAR(20),
  settings   JSONB        NOT NULL DEFAULT '{}',
  limits     JSONB        NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── USERS ─────────────────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       VARCHAR,                          -- VARCHAR: multi-tenant via app layer
  network_id      VARCHAR,
  name            VARCHAR(200) NOT NULL,
  email           VARCHAR(200) UNIQUE NOT NULL,
  password        VARCHAR(255) NOT NULL,
  role            VARCHAR(50)  NOT NULL DEFAULT 'technician',
  status          VARCHAR(30)  NOT NULL DEFAULT 'active',
  phone           VARCHAR(20),
  avatar          VARCHAR,
  last_login      TIMESTAMPTZ,
  settings        JSONB        NOT NULL DEFAULT '{}',
  presence_status VARCHAR(20)  DEFAULT 'offline',
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── NETWORKS ──────────────────────────────────────────────────
CREATE TABLE networks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   VARCHAR        NOT NULL,
  code        VARCHAR(6),
  name        VARCHAR(200)   NOT NULL,
  status      VARCHAR(30)    NOT NULL DEFAULT 'active',
  responsible VARCHAR(200),
  phone       VARCHAR(20),
  email       VARCHAR(200),
  notes       TEXT,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── CLIENTS ───────────────────────────────────────────────────
CREATE TABLE clients (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    VARCHAR        NOT NULL,
  network_id   VARCHAR,
  code         VARCHAR(6),
  person_type  VARCHAR(10)    NOT NULL DEFAULT 'juridica',
  company_name VARCHAR(200)   NOT NULL,
  trade_name   VARCHAR(200),
  cnpj         VARCHAR(18),
  cpf          VARCHAR(14),
  ie           VARCHAR(50),
  address      VARCHAR(300),
  number       VARCHAR(20),
  complement   VARCHAR(100),
  neighborhood VARCHAR(100),
  city         VARCHAR(100),
  state        VARCHAR(2),
  zip_code     VARCHAR(10),
  reference    TEXT,
  phone        VARCHAR(20),
  whatsapp     VARCHAR(20),
  email        VARCHAR(200),
  website      VARCHAR(200),
  status       VARCHAR(30)    NOT NULL DEFAULT 'active',
  support_plan VARCHAR(50),
  client_since VARCHAR(7),
  notes        TEXT,
  metadata     JSONB          NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── CONTACTS ──────────────────────────────────────────────────
CREATE TABLE contacts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         VARCHAR      NOT NULL,
  client_id         UUID         REFERENCES clients(id) ON DELETE SET NULL,
  name              VARCHAR(200) NOT NULL,
  role              VARCHAR(100),
  department        VARCHAR(100),
  phone             VARCHAR(20),
  email             VARCHAR(200),
  whatsapp          VARCHAR(20),
  preferred_channel VARCHAR(30)  NOT NULL DEFAULT 'email',
  can_open_tickets  BOOLEAN      NOT NULL DEFAULT TRUE,
  status            VARCHAR(30)  NOT NULL DEFAULT 'active',
  portal_password   VARCHAR(255),
  notes             TEXT,
  is_primary        BOOLEAN      NOT NULL DEFAULT FALSE,
  metadata          JSONB        DEFAULT '{}',
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── CONTACT_CUSTOMERS (vínculo N:N contato ↔ cliente) ─────────
CREATE TABLE contact_customers (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID         NOT NULL,
  contact_id UUID         NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  client_id  UUID         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  linked_by  UUID,
  linked_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_contact_client UNIQUE (contact_id, client_id)
);

-- ── CONTRACTS ─────────────────────────────────────────────────
CREATE TABLE contracts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          VARCHAR     NOT NULL,
  client_id          VARCHAR     NOT NULL,
  contract_type      contracts_contract_type_enum NOT NULL DEFAULT 'monthly',
  monthly_hours      INT         NOT NULL DEFAULT 0,
  sla_response_hours INT         NOT NULL DEFAULT 4,
  sla_resolve_hours  INT         NOT NULL DEFAULT 24,
  monthly_value      NUMERIC(10,2) NOT NULL DEFAULT 0,
  start_date         DATE        NOT NULL,
  end_date           DATE,
  services_included  JSONB       NOT NULL DEFAULT '[]',
  ticket_limit       INT         NOT NULL DEFAULT 0,
  hours_used         NUMERIC(10,2) NOT NULL DEFAULT 0,
  tickets_used       INT         NOT NULL DEFAULT 0,
  status             contracts_status_enum NOT NULL DEFAULT 'active',
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CONVERSATIONS ─────────────────────────────────────────────
CREATE TABLE conversations (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      VARCHAR      NOT NULL,
  contact_id     VARCHAR      NOT NULL,
  client_id      VARCHAR,
  channel        conversations_channel_enum NOT NULL,
  status         conversations_status_enum  NOT NULL DEFAULT 'active',
  ticket_id      VARCHAR,
  chat_alert     BOOLEAN      NOT NULL DEFAULT FALSE,
  initiated_by   conversations_initiated_by_enum NOT NULL DEFAULT 'contact',
  whatsapp_channel_id UUID,
  last_message_at TIMESTAMPTZ,
  queued_at      TIMESTAMPTZ,
  attendance_started_at TIMESTAMPTZ,
  first_agent_reply_at TIMESTAMPTZ,
  conversation_closed_at TIMESTAMPTZ,
  priority_id    UUID,
  sla_policy_id  UUID,
  sla_first_response_deadline TIMESTAMPTZ,
  sla_resolution_deadline TIMESTAMPTZ,
  sla_first_response_at TIMESTAMPTZ,
  sla_resolved_at TIMESTAMPTZ,
  sla_status     VARCHAR(12),
  tags           TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── CONVERSATION MESSAGES ─────────────────────────────────────
CREATE TABLE conversation_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       VARCHAR  NOT NULL,
  conversation_id UUID     NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_id       VARCHAR,
  author_type     VARCHAR  NOT NULL DEFAULT 'user',
  author_name     VARCHAR  NOT NULL,
  content         TEXT     NOT NULL,
  media_kind      VARCHAR(16),
  media_storage_key TEXT,
  media_mime      VARCHAR(128),
  external_id     TEXT,
  whatsapp_status TEXT,
  reply_to_id     UUID REFERENCES conversation_messages(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TICKETS ───────────────────────────────────────────────────
CREATE TABLE tickets (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             VARCHAR      NOT NULL,
  ticket_number         VARCHAR      UNIQUE NOT NULL,
  client_id             VARCHAR,
  contact_id            VARCHAR,
  contract_id           VARCHAR,
  assigned_to           VARCHAR,
  origin                tickets_origin_enum   NOT NULL DEFAULT 'portal',
  priority              tickets_priority_enum NOT NULL DEFAULT 'medium',
  priority_id           UUID,
  status                tickets_status_enum   NOT NULL DEFAULT 'open',
  department            VARCHAR,
  category              VARCHAR,
  subcategory           VARCHAR,
  subject               VARCHAR      NOT NULL,
  description           TEXT         NOT NULL,
  resolution_summary    TEXT,
  cancel_reason         TEXT,
  sla_response_at       TIMESTAMPTZ,
  sla_resolve_at        TIMESTAMPTZ,
  first_response_at     TIMESTAMPTZ,
  auto_assigned_at      TIMESTAMPTZ,
  resolved_at           TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  time_spent_min        INT          NOT NULL DEFAULT 0,
  root_cause            TEXT,
  complexity            INT,
  escalated             BOOLEAN      NOT NULL DEFAULT FALSE,
  tags                  TEXT,
  metadata              JSONB,
  conversation_id       VARCHAR,
  satisfaction_score    VARCHAR,
  satisfaction_at       TIMESTAMPTZ,
  satisfaction_rating   INT          CHECK (satisfaction_rating IS NULL OR (satisfaction_rating >= 1 AND satisfaction_rating <= 5)),
  satisfaction_comment  TEXT,
  unlinked_contact      BOOLEAN      NOT NULL DEFAULT FALSE,
  customer_selected_at  TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── TICKET MESSAGES ───────────────────────────────────────────
CREATE TABLE ticket_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    VARCHAR  NOT NULL,
  ticket_id    VARCHAR  NOT NULL,
  author_id    VARCHAR,
  author_type  VARCHAR  NOT NULL DEFAULT 'user',
  author_name  VARCHAR  NOT NULL,
  "messageType" ticket_messages_messagetype_enum NOT NULL DEFAULT 'comment',
  content      TEXT     NOT NULL,
  attachments  JSONB,
  channel      VARCHAR,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ticket_reply_attachments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           VARCHAR         NOT NULL,
  ticket_id           UUID            NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  ticket_message_id   UUID            NOT NULL REFERENCES ticket_messages(id) ON DELETE CASCADE,
  storage_key         TEXT            NOT NULL,
  mime                VARCHAR(256),
  size_bytes          BIGINT,
  original_filename   TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ── TICKET SETTINGS (departamentos, categorias, subcategorias) ─
CREATE TABLE ticket_settings (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  VARCHAR    NOT NULL,
  type       ticket_settings_type_enum NOT NULL,
  name       VARCHAR(120) NOT NULL,
  parent_id  VARCHAR,
  default_priority_id UUID,
  active     BOOLEAN    NOT NULL DEFAULT TRUE,
  sort_order INT        NOT NULL DEFAULT 0,
  color      VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TAGS ──────────────────────────────────────────────────────
CREATE TABLE tags (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  VARCHAR     NOT NULL,
  name       VARCHAR(80) NOT NULL,
  color      VARCHAR(20),
  active     BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE root_causes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  VARCHAR      NOT NULL,
  name       VARCHAR(120) NOT NULL,
  active     BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order INT          NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE sla_policies (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              VARCHAR      NOT NULL,
  name                   VARCHAR(120) NOT NULL,
  priority               VARCHAR(10)  NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  first_response_minutes INTEGER      NOT NULL DEFAULT 60,
  resolution_minutes     INTEGER      NOT NULL DEFAULT 480,
  is_default             BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE tenant_priorities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     VARCHAR      NOT NULL,
  name          VARCHAR(120) NOT NULL,
  slug          VARCHAR(64)  NOT NULL,
  color         VARCHAR(20)  NOT NULL DEFAULT '#64748B',
  sort_order    INTEGER      NOT NULL DEFAULT 0,
  active        BOOLEAN      NOT NULL DEFAULT TRUE,
  sla_policy_id UUID         REFERENCES sla_policies(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tenant_priorities_tenant_slug UNIQUE (tenant_id, slug)
);
-- ── DEVICES ───────────────────────────────────────────────────
CREATE TABLE devices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       VARCHAR      NOT NULL,
  client_id       VARCHAR      NOT NULL,
  name            VARCHAR      NOT NULL,
  device_type     devices_device_type_enum NOT NULL DEFAULT 'pdv',
  ip_address      VARCHAR,
  mac_address     VARCHAR,
  system_version  VARCHAR,
  notes           TEXT,
  status          devices_status_enum NOT NULL DEFAULT 'unknown',
  last_heartbeat  TIMESTAMPTZ,
  heartbeat_token VARCHAR      UNIQUE NOT NULL,
  config          JSONB,
  last_metrics    JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── DEVICE METRICS ────────────────────────────────────────────
CREATE TABLE device_metrics (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   VARCHAR          NOT NULL,
  device_id   VARCHAR          NOT NULL,
  cpu         NUMERIC(5,2),
  memory      NUMERIC(5,2),
  disk        NUMERIC(10,2),
  recorded_at TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- ── DEVICE EVENTS ─────────────────────────────────────────────
CREATE TABLE device_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  VARCHAR  NOT NULL,
  device_id  VARCHAR  NOT NULL,
  event_type VARCHAR  NOT NULL,
  severity   VARCHAR  NOT NULL DEFAULT 'info',
  message    TEXT     NOT NULL,
  metadata   JSONB,
  ticket_id  VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── KNOWLEDGE BASE ────────────────────────────────────────────
CREATE TABLE kb_categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  VARCHAR     NOT NULL,
  name       VARCHAR     NOT NULL,
  slug       VARCHAR     NOT NULL,
  parent_id  VARCHAR,
  visibility VARCHAR     NOT NULL DEFAULT 'internal',
  sort_order INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE kb_articles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   VARCHAR  NOT NULL,
  category_id VARCHAR,
  author_id   VARCHAR  NOT NULL,
  title       VARCHAR  NOT NULL,
  content     TEXT     NOT NULL,
  visibility  VARCHAR  NOT NULL DEFAULT 'internal',
  status      VARCHAR  NOT NULL DEFAULT 'published',
  views       INT      NOT NULL DEFAULT 0,
  tags        TEXT,
  attachments JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── WHATSAPP CONNECTIONS ──────────────────────────────────────
CREATE TABLE whatsapp_connections (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            VARCHAR NOT NULL,
  label                VARCHAR(100) NOT NULL DEFAULT 'Principal',
  is_default           BOOLEAN      NOT NULL DEFAULT false,
  provider             whatsapp_connections_provider_enum NOT NULL DEFAULT 'baileys',
  status               whatsapp_connections_status_enum   NOT NULL DEFAULT 'disconnected',
  phone_number         VARCHAR,
  meta_phone_number_id VARCHAR,
  meta_waba_id         VARCHAR,
  meta_token           TEXT,
  meta_verify_token    VARCHAR,
  meta_webhook_url     VARCHAR,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_whatsapp_channel
  FOREIGN KEY (whatsapp_channel_id)
  REFERENCES whatsapp_connections(id)
  ON DELETE SET NULL;

ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_priority
  FOREIGN KEY (priority_id)
  REFERENCES tenant_priorities(id)
  ON DELETE SET NULL;

ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_sla_policy
  FOREIGN KEY (sla_policy_id)
  REFERENCES sla_policies(id)
  ON DELETE SET NULL;

ALTER TABLE tickets
  ADD CONSTRAINT fk_tickets_priority
  FOREIGN KEY (priority_id)
  REFERENCES tenant_priorities(id)
  ON DELETE SET NULL;

ALTER TABLE ticket_settings
  ADD CONSTRAINT fk_ticket_settings_default_priority
  FOREIGN KEY (default_priority_id)
  REFERENCES tenant_priorities(id)
  ON DELETE SET NULL;

ALTER TABLE ticket_settings
  ADD CONSTRAINT ticket_settings_default_priority_allowed_types_chk
  CHECK (
    type::text IN ('department', 'category', 'subcategory')
    OR default_priority_id IS NULL
  );

-- ── CHATBOT CONFIGS ───────────────────────────────────────────
CREATE TABLE chatbot_configs (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    VARCHAR  NOT NULL,
  name                         VARCHAR  NOT NULL DEFAULT 'Assistente Virtual',
  welcome_message              TEXT     NOT NULL DEFAULT 'Olá! Seja bem-vindo. Como posso te ajudar hoje?',
  menu_title                   VARCHAR  NOT NULL DEFAULT 'Escolha uma das opções abaixo:',
  enabled                      BOOLEAN  NOT NULL DEFAULT FALSE,
  channel_whatsapp             BOOLEAN  NOT NULL DEFAULT FALSE,
  channel_web                  BOOLEAN  NOT NULL DEFAULT FALSE,
  channel_portal               BOOLEAN  NOT NULL DEFAULT FALSE,
  transfer_message             TEXT     NOT NULL DEFAULT 'Aguarde um momento, estou te conectando com um atendente...',
  no_agent_message             TEXT     NOT NULL DEFAULT 'No momento todos os atendentes estão ocupados. Sua mensagem foi registrada e entraremos em contato em breve.',
  invalid_option_message       TEXT     NOT NULL DEFAULT 'Opção inválida. Por favor, escolha uma das opções do menu:',
  session_timeout_minutes      INT      NOT NULL DEFAULT 30,
  collect_cnpj                 BOOLEAN  NOT NULL DEFAULT TRUE,
  cnpj_request_message         TEXT     NOT NULL DEFAULT 'Para identificar sua empresa, informe o CNPJ (somente números) ou responda *pular*:',
  cnpj_not_found_message       TEXT     NOT NULL DEFAULT 'Empresa não encontrada. Não se preocupe, nosso atendente irá identificá-la.',
  description_request_message  TEXT     NOT NULL DEFAULT 'Antes de transferirmos o atendimento, descreva sua demanda no campo abaixo para agilizar o suporte.',
  description_timeout_minutes  INT      NOT NULL DEFAULT 3,
  post_ticket_message          TEXT,
  post_ticket_message_no_agent TEXT,
  rating_request_message       TEXT,
  rating_comment_message       TEXT,
  rating_thanks_message        TEXT,
  collect_name                 BOOLEAN  NOT NULL DEFAULT false,
  name_request_message         TEXT     NOT NULL DEFAULT 'Olá! Para começarmos, pode me informar seu nome completo?',
  whatsapp_prefix_agent_name   BOOLEAN  NOT NULL DEFAULT false,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CHATBOT MENU ITEMS ────────────────────────────────────────
CREATE TABLE chatbot_menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       VARCHAR  NOT NULL,
  chatbot_id      UUID     NOT NULL REFERENCES chatbot_configs(id) ON DELETE CASCADE,
  "order"         INT      NOT NULL,
  label           VARCHAR  NOT NULL,
  action          VARCHAR  NOT NULL DEFAULT 'transfer',
  auto_reply_text TEXT,
  department      VARCHAR,
  enabled         BOOLEAN  NOT NULL DEFAULT TRUE
);

-- ── CHATBOT SESSIONS ──────────────────────────────────────────
CREATE TABLE chatbot_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       VARCHAR  NOT NULL,
  identifier      VARCHAR  NOT NULL,
  channel         VARCHAR  NOT NULL DEFAULT 'whatsapp',
  step            VARCHAR  NOT NULL DEFAULT 'welcome',
  conversation_id VARCHAR,
  contact_id      VARCHAR,
  whatsapp_channel_id UUID REFERENCES whatsapp_connections(id) ON DELETE SET NULL,
  metadata        JSONB,
  last_activity   TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CHATBOT WIDGET MESSAGES ───────────────────────────────────
CREATE TABLE chatbot_widget_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  VARCHAR  NOT NULL,
  session_id VARCHAR  NOT NULL,
  role       VARCHAR  NOT NULL,
  content    TEXT     NOT NULL,
  is_read    BOOLEAN  NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TENANT SETTINGS ───────────────────────────────────────────
-- Nota: colunas em camelCase pois TypeORM não usa SnakeCaseNamingStrategy
CREATE TABLE tenant_settings (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         VARCHAR NOT NULL,
  "companyName"     VARCHAR,
  "companyEmail"    VARCHAR,
  "companyPhone"    VARCHAR,
  "companyAddress"  VARCHAR,
  "companyCnpj"     VARCHAR,
  "companyLogo"     VARCHAR,
  "primaryColor"    VARCHAR DEFAULT '#6366F1',
  "secondaryColor"  VARCHAR DEFAULT '#4F46E5',
  "smtpHost"        VARCHAR,
  "smtpPort"        VARCHAR,
  "smtpUser"        VARCHAR,
  "smtpPass"        VARCHAR,
  "smtpFrom"        VARCHAR,
  "smtpSecure"      VARCHAR DEFAULT 'false',
  "slaLowHours"     VARCHAR DEFAULT '72',
  "slaMediumHours"  VARCHAR DEFAULT '48',
  "slaHighHours"    VARCHAR DEFAULT '24',
  "slaCriticalHours" VARCHAR DEFAULT '4',
  "alertSettings"   JSONB   NOT NULL DEFAULT '{}',
  "businessHours"   JSONB,
  holidays          TEXT,
  ticket_created_notify VARCHAR NOT NULL DEFAULT 'false',
  ticket_resolved_notify VARCHAR NOT NULL DEFAULT 'true',
  sla_warning_notify VARCHAR NOT NULL DEFAULT 'true',
  escalation_email  VARCHAR,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── PERMISSIONS / ROLES ───────────────────────────────────────
CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        VARCHAR(80)  UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  module      VARCHAR(60)  NOT NULL DEFAULT 'general',
  description VARCHAR(200),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug        VARCHAR(50)  UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(200),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ── ROUTING RULES ─────────────────────────────────────────────
CREATE TABLE routing_rules (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           VARCHAR  NOT NULL,
  name                VARCHAR  NOT NULL,
  active              BOOLEAN  NOT NULL DEFAULT TRUE,
  priority            INT      NOT NULL DEFAULT 0,
  cond_department     VARCHAR,
  cond_category       VARCHAR,
  cond_priority       VARCHAR,
  cond_origin         VARCHAR,
  action_assign_to    VARCHAR,
  action_set_priority VARCHAR,
  action_notify_email VARCHAR,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── API KEYS ──────────────────────────────────────────────────
CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   VARCHAR  NOT NULL,
  name        VARCHAR  NOT NULL,
  key         VARCHAR  UNIQUE NOT NULL,
  active      BOOLEAN  NOT NULL DEFAULT TRUE,
  permissions TEXT     NOT NULL DEFAULT 'read',
  last_used_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── WEBHOOKS ──────────────────────────────────────────────────
CREATE TABLE webhooks (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    VARCHAR  NOT NULL,
  name         VARCHAR  NOT NULL,
  url          VARCHAR  NOT NULL,
  secret       VARCHAR,
  active       BOOLEAN  NOT NULL DEFAULT TRUE,
  events       TEXT     NOT NULL DEFAULT 'ticket.created,ticket.updated,ticket.resolved',
  last_fired_at TIMESTAMPTZ,
  last_status  VARCHAR,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TENANT LICENSES ───────────────────────────────────────────
CREATE TABLE tenant_licenses (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID        NOT NULL,
  plan_slug         VARCHAR(50) NOT NULL,
  status            VARCHAR(30) NOT NULL DEFAULT 'trial',
  billing_cycle     VARCHAR(30) NOT NULL DEFAULT 'monthly',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  extra_limits      JSONB       NOT NULL DEFAULT '{}',
  meta              JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AUDIT LOGS ────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action        VARCHAR(100)  NOT NULL,
  user_id       VARCHAR(100)  NOT NULL,
  user_email    VARCHAR(200),
  user_type     VARCHAR(50)   NOT NULL,
  entity_type   VARCHAR(100)  NOT NULL,
  entity_id     VARCHAR(100)  NOT NULL,
  details       JSONB         NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── TEAM CHAT ─────────────────────────────────────────────────
CREATE TABLE team_chat_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   VARCHAR  NOT NULL,
  author_id   VARCHAR  NOT NULL,
  author_name VARCHAR  NOT NULL,
  content     TEXT     NOT NULL,
  channel     VARCHAR  NOT NULL DEFAULT 'general',
  reply_to    VARCHAR,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── INTERNAL CHAT (DMs entre agentes) ─────────────────────────
CREATE TABLE internal_chat_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    VARCHAR  NOT NULL,
  sender_id    VARCHAR  NOT NULL,
  sender_name  VARCHAR  NOT NULL,
  recipient_id VARCHAR,
  content      TEXT     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AGENT ATTENDANCE ──────────────────────────────────────────
CREATE TABLE agent_attendance (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             VARCHAR  NOT NULL,
  user_id               VARCHAR  NOT NULL,
  user_name             VARCHAR,
  user_email            VARCHAR,
  user_role             VARCHAR,
  clock_in              TIMESTAMPTZ NOT NULL,
  clock_out             TIMESTAMPTZ,
  notes                 VARCHAR,
  ip_address            VARCHAR,
  pause_type            VARCHAR,
  pause_start           TIMESTAMPTZ,
  pause_end             TIMESTAMPTZ,
  pause_allowed_by      VARCHAR,
  pause_allowed_by_name VARCHAR,
  total_pause_minutes   INT  NOT NULL DEFAULT 0,
  availability          VARCHAR NOT NULL DEFAULT 'online',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TICKET ASSIGNMENT (round-robin) ───────────────────────────
CREATE TABLE agent_departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       VARCHAR NOT NULL,
  user_id         VARCHAR NOT NULL,
  department_name VARCHAR NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_agent_dept UNIQUE (tenant_id, user_id, department_name)
);

CREATE TABLE distribution_queues (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             VARCHAR NOT NULL,
  department_name       VARCHAR NOT NULL,
  last_assigned_user_id VARCHAR,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_dist_queue UNIQUE (tenant_id, department_name)
);

-- ── INDEXES ───────────────────────────────────────────────────
-- Tickets
CREATE INDEX idx_tickets_tenant_status ON tickets(tenant_id, status);
CREATE INDEX idx_tickets_assigned       ON tickets(assigned_to, status);
CREATE INDEX idx_tickets_client         ON tickets(client_id, created_at DESC);
CREATE INDEX idx_tickets_sla            ON tickets(sla_resolve_at) WHERE status NOT IN ('resolved','closed','cancelled');
CREATE INDEX idx_tickets_conversation   ON tickets(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX idx_tickets_tenant_priority_id
  ON tickets (tenant_id, priority_id)
  WHERE priority_id IS NOT NULL;

-- Ticket messages
CREATE INDEX idx_messages_ticket        ON ticket_messages(ticket_id, created_at);
CREATE INDEX idx_ticket_reply_attachments_tenant_message
  ON ticket_reply_attachments (tenant_id, ticket_message_id);
CREATE INDEX idx_ticket_reply_attachments_tenant_created
  ON ticket_reply_attachments (tenant_id, created_at);
CREATE INDEX idx_ticket_reply_attachments_tenant_ticket
  ON ticket_reply_attachments (tenant_id, ticket_id);

-- Clients / Contacts
CREATE INDEX idx_clients_tenant         ON clients(tenant_id, status);
CREATE INDEX idx_contacts_whatsapp      ON contacts(tenant_id, whatsapp);
CREATE INDEX idx_contacts_email         ON contacts(tenant_id, email);
CREATE INDEX idx_contacts_client        ON contacts(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_contact_customers_contact
  ON contact_customers(tenant_id, contact_id);
CREATE INDEX idx_contact_customers_client
  ON contact_customers(tenant_id, client_id);

-- Contracts
CREATE INDEX idx_contracts_client       ON contracts(tenant_id, client_id, status);

-- Users / Team
CREATE INDEX idx_users_role
  ON users(role);
CREATE INDEX idx_users_presence_timeout
  ON users (presence_status, last_seen_at)
  WHERE presence_status IS NOT NULL AND presence_status != 'offline';
CREATE INDEX idx_users_tenant_role_status
  ON users (tenant_id, role, status)
  WHERE status = 'active';
CREATE INDEX idx_users_tenant_presence
  ON users (tenant_id, presence_status, last_seen_at)
  WHERE presence_status IS NOT NULL AND presence_status <> 'offline';
CREATE INDEX tenants_cnpj_idx
  ON tenants(cnpj);
CREATE INDEX tenant_licenses_tenant_idx
  ON tenant_licenses (tenant_id);
CREATE INDEX tenant_licenses_status_idx
  ON tenant_licenses (status);
CREATE INDEX audit_logs_action_idx
  ON audit_logs (action);
CREATE INDEX audit_logs_entity_idx
  ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_user_idx
  ON audit_logs (user_type, user_id);
CREATE INDEX audit_logs_created_at_idx
  ON audit_logs (created_at);

-- Devices
CREATE INDEX idx_devices_heartbeat      ON devices(tenant_id, last_heartbeat);
CREATE INDEX idx_devices_status         ON devices(tenant_id, status);
CREATE INDEX idx_device_events_device   ON device_events(device_id, created_at DESC);
CREATE INDEX idx_device_metrics         ON device_metrics(tenant_id, device_id, recorded_at);

-- Conversations
CREATE INDEX idx_conversations_contact  ON conversations(tenant_id, contact_id, status);
CREATE INDEX idx_conversations_ticket   ON conversations(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX idx_conversations_whatsapp_channel_id
  ON conversations(whatsapp_channel_id)
  WHERE whatsapp_channel_id IS NOT NULL;
CREATE INDEX idx_conversations_priority
  ON conversations (tenant_id, priority_id)
  WHERE priority_id IS NOT NULL;
CREATE INDEX idx_conversations_sla_status
  ON conversations (tenant_id, sla_status)
  WHERE sla_status IS NOT NULL;
CREATE INDEX idx_conversations_queued_at
  ON conversations(tenant_id, queued_at);
CREATE INDEX idx_conversations_attendance_started_at
  ON conversations(tenant_id, attendance_started_at)
  WHERE attendance_started_at IS NOT NULL;
CREATE UNIQUE INDEX uq_conversations_active_contact_channel
  ON conversations (tenant_id, contact_id, channel)
  WHERE status = 'active';
CREATE INDEX idx_tags_tenant_active     ON tags(tenant_id, active, sort_order, name);
CREATE INDEX idx_root_causes_tenant_active ON root_causes(tenant_id, active, sort_order, name);
CREATE INDEX idx_conv_messages_conv     ON conversation_messages(conversation_id, created_at);
CREATE INDEX idx_conv_messages_reply_to
  ON conversation_messages(reply_to_id)
  WHERE reply_to_id IS NOT NULL;
CREATE UNIQUE INDEX uq_conversation_messages_tenant_external_id
  ON conversation_messages (tenant_id, external_id)
  WHERE external_id IS NOT NULL AND btrim(external_id) <> '';

CREATE INDEX idx_sla_policies_tenant
  ON sla_policies (tenant_id);
CREATE INDEX idx_sla_policies_tenant_priority
  ON sla_policies (tenant_id, priority);
CREATE UNIQUE INDEX uq_sla_policies_tenant_default
  ON sla_policies (tenant_id)
  WHERE is_default = TRUE;

CREATE INDEX idx_tenant_priorities_tenant
  ON tenant_priorities (tenant_id);
CREATE INDEX idx_tenant_priorities_tenant_active
  ON tenant_priorities (tenant_id, active);
CREATE INDEX idx_tenant_priorities_sla_policy
  ON tenant_priorities (sla_policy_id)
  WHERE sla_policy_id IS NOT NULL;
CREATE INDEX idx_ticket_settings_default_priority
  ON ticket_settings (default_priority_id)
  WHERE default_priority_id IS NOT NULL;

CREATE UNIQUE INDEX uq_whatsapp_connections_tenant_meta_phone
  ON whatsapp_connections (tenant_id, meta_phone_number_id)
  WHERE meta_phone_number_id IS NOT NULL
    AND btrim(meta_phone_number_id) <> '';

-- Chatbot sessions
CREATE UNIQUE INDEX chatbot_configs_tenant_idx
  ON chatbot_configs(tenant_id);
CREATE INDEX chatbot_menu_chatbot_idx
  ON chatbot_menu_items(chatbot_id);
CREATE INDEX chatbot_sessions_lookup_idx
  ON chatbot_sessions(tenant_id, identifier, channel);
CREATE INDEX chatbot_widget_msgs_session_idx
  ON chatbot_widget_messages(session_id, created_at);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
-- Política: se app.tenant_id não estiver definido, todos os registros
-- são visíveis (compatível com operações de sistema/admin).
-- Quando definido, só registros do tenant correspondente são visíveis.
ALTER TABLE tickets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tickets
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON ticket_messages
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON clients
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON contacts
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON contracts
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON devices
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON device_events
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON conversations
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON conversation_messages
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true));

-- ── SEED: Demo tenant ─────────────────────────────────────────
INSERT INTO tenants (id, name, slug, plan, status, email) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Demo Automação Comercial', 'demo', 'professional', 'active',
   'admin@demo.com');

-- Admin password: Admin@123  (bcrypt $2a$12$oZ8A7aDHpDDLcuLDFwuiO.kTR4kJilNsyBlSGIlNP/bpEByeIJUTu)
INSERT INTO users (tenant_id, name, email, password, role) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Administrador', 'admin@demo.com',
   '$2a$12$oZ8A7aDHpDDLcuLDFwuiO.kTR4kJilNsyBlSGIlNP/bpEByeIJUTu',
   'admin'),
  ('00000000-0000-0000-0000-000000000001',
   'João Técnico', 'tecnico@demo.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdWnYfEJUO5xjK2',
   'technician'),
  ('00000000-0000-0000-0000-000000000001',
   'Maria Gestora', 'manager@demo.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdWnYfEJUO5xjK2',
   'manager');

INSERT INTO clients (tenant_id, company_name, trade_name, cnpj, city, state, email, phone) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Supermercado Bom Preço Ltda', 'Bom Preço',
   '12.345.678/0001-90', 'São Paulo', 'SP', 'ti@bompreco.com.br', '(11) 9999-1111'),
  ('00000000-0000-0000-0000-000000000001',
   'Farmácia Saúde Total ME', 'Saúde Total',
   '98.765.432/0001-10', 'Campinas', 'SP', 'suporte@saudetotal.com.br', '(19) 8888-2222'),
  ('00000000-0000-0000-0000-000000000001',
   'Restaurante Sabor & Arte Ltda', 'Sabor & Arte',
   '45.678.901/0001-23', 'São Paulo', 'SP', 'financeiro@saborarte.com.br', '(11) 7777-3333');

SELECT 'SempreDesk schema v2.0 criado com sucesso!' AS status;

