-- ================================================================
-- Sistema de Suporte Técnico — Schema v1.0
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── TENANTS ───────────────────────────────────────────────────
CREATE TABLE tenants (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(200) NOT NULL,
  slug       VARCHAR(100) UNIQUE NOT NULL,
  plan       VARCHAR(30)  NOT NULL DEFAULT 'starter',
  status     VARCHAR(30)  NOT NULL DEFAULT 'trial',
  email      VARCHAR(200),
  phone      VARCHAR(20),
  settings   JSONB NOT NULL DEFAULT '{}',
  limits     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── USERS ─────────────────────────────────────────────────────
CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name       VARCHAR(200) NOT NULL,
  email      VARCHAR(200) UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,
  role       VARCHAR(50)  NOT NULL DEFAULT 'technician',
  status     VARCHAR(30)  NOT NULL DEFAULT 'active',
  phone      VARCHAR(20),
  avatar     TEXT,
  last_login TIMESTAMPTZ,
  settings   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── CLIENTS ───────────────────────────────────────────────────
CREATE TABLE clients (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_name VARCHAR(200) NOT NULL,
  trade_name   VARCHAR(200),
  cnpj         VARCHAR(18),
  address      VARCHAR(300),
  city         VARCHAR(100),
  state        VARCHAR(2),
  phone        VARCHAR(20),
  email        VARCHAR(200),
  status       VARCHAR(30) NOT NULL DEFAULT 'active',
  support_plan VARCHAR(50),
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CONTACTS ──────────────────────────────────────────────────
CREATE TABLE contacts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name              VARCHAR(200) NOT NULL,
  role              VARCHAR(100),
  department        VARCHAR(100),
  phone             VARCHAR(20),
  email             VARCHAR(200),
  whatsapp          VARCHAR(20),
  preferred_channel VARCHAR(30) NOT NULL DEFAULT 'email',
  can_open_tickets  BOOLEAN NOT NULL DEFAULT TRUE,
  status            VARCHAR(30) NOT NULL DEFAULT 'active',
  portal_password   VARCHAR(255),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CONTRACTS ─────────────────────────────────────────────────
CREATE TABLE contracts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id          UUID NOT NULL REFERENCES clients(id),
  contract_type      VARCHAR(100),
  monthly_hours      DECIMAL(10,2),
  sla_response_hours INT,
  sla_resolve_hours  INT,
  monthly_value      DECIMAL(12,2),
  start_date         DATE NOT NULL,
  end_date           DATE,
  services_included  JSONB NOT NULL DEFAULT '[]',
  ticket_limit       INT,
  hours_used         DECIMAL(10,2) NOT NULL DEFAULT 0,
  tickets_used       INT NOT NULL DEFAULT 0,
  status             VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TICKETS ───────────────────────────────────────────────────
CREATE TABLE tickets (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_number     VARCHAR(20) UNIQUE NOT NULL,
  client_id         UUID NOT NULL REFERENCES clients(id),
  contact_id        UUID REFERENCES contacts(id),
  contract_id       UUID REFERENCES contracts(id),
  assigned_to       UUID REFERENCES users(id),
  origin            VARCHAR(30) NOT NULL DEFAULT 'portal',
  priority          VARCHAR(20) NOT NULL DEFAULT 'medium',
  status            VARCHAR(30) NOT NULL DEFAULT 'open',
  category          VARCHAR(100),
  subject           VARCHAR(500) NOT NULL,
  description       TEXT,
  sla_response_at   TIMESTAMPTZ,
  sla_resolve_at    TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  time_spent_min    INT NOT NULL DEFAULT 0,
  escalated         BOOLEAN NOT NULL DEFAULT FALSE,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TICKET MESSAGES ───────────────────────────────────────────
CREATE TABLE ticket_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id    UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id    UUID,
  author_type  VARCHAR(20) NOT NULL DEFAULT 'user',
  author_name  VARCHAR(200),
  message_type VARCHAR(20) NOT NULL DEFAULT 'reply',
  content      TEXT NOT NULL,
  attachments  JSONB NOT NULL DEFAULT '[]',
  channel      VARCHAR(30),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── DEVICES ───────────────────────────────────────────────────
CREATE TABLE devices (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id),
  name             VARCHAR(200) NOT NULL,
  device_type      VARCHAR(50)  NOT NULL DEFAULT 'pdv',
  ip_address       VARCHAR(50),
  mac_address      VARCHAR(17),
  system_version   VARCHAR(100),
  notes            TEXT,
  status           VARCHAR(20)  NOT NULL DEFAULT 'unknown',
  last_heartbeat   TIMESTAMPTZ,
  heartbeat_token  VARCHAR(100) UNIQUE,
  config           JSONB NOT NULL DEFAULT '{}',
  last_metrics     JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── DEVICE EVENTS ─────────────────────────────────────────────
CREATE TABLE device_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event_type VARCHAR(50)  NOT NULL,
  severity   VARCHAR(20)  NOT NULL DEFAULT 'medium',
  message    TEXT,
  metadata   JSONB NOT NULL DEFAULT '{}',
  ticket_id  UUID REFERENCES tickets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── KNOWLEDGE BASE ────────────────────────────────────────────
CREATE TABLE kb_categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       VARCHAR(200) NOT NULL,
  slug       VARCHAR(200),
  parent_id  UUID REFERENCES kb_categories(id),
  visibility VARCHAR(20) NOT NULL DEFAULT 'internal',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE kb_articles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id UUID REFERENCES kb_categories(id),
  author_id   UUID REFERENCES users(id),
  title       VARCHAR(500) NOT NULL,
  content     TEXT,
  visibility  VARCHAR(20) NOT NULL DEFAULT 'internal',
  status      VARCHAR(20) NOT NULL DEFAULT 'published',
  views       INT NOT NULL DEFAULT 0,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  attachments JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX idx_tickets_tenant_status  ON tickets(tenant_id, status);
CREATE INDEX idx_tickets_assigned       ON tickets(assigned_to, status);
CREATE INDEX idx_tickets_client         ON tickets(client_id, created_at DESC);
CREATE INDEX idx_tickets_sla            ON tickets(sla_resolve_at) WHERE status NOT IN ('resolved','closed');
CREATE INDEX idx_messages_ticket        ON ticket_messages(ticket_id, created_at);
CREATE INDEX idx_clients_tenant         ON clients(tenant_id, status);
CREATE INDEX idx_contacts_whatsapp      ON contacts(tenant_id, whatsapp);
CREATE INDEX idx_contacts_email         ON contacts(tenant_id, email);
CREATE INDEX idx_devices_heartbeat      ON devices(tenant_id, last_heartbeat);
CREATE INDEX idx_devices_status         ON devices(tenant_id, status);
CREATE INDEX idx_device_events_device   ON device_events(device_id, created_at DESC);
CREATE INDEX idx_contracts_client       ON contracts(tenant_id, client_id, status);

-- ── ROW LEVEL SECURITY (RLS) ───────────────────────────────────
-- Política compatível: se app.tenant_id NÃO estiver definido,
-- o registro é visível (comportamento atual é preservado).
-- Quando app.tenant_id estiver definido, a linha só é visível
-- se tenant_id bater com o valor da sessão.

ALTER TABLE tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_articles     ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tickets ON tickets
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY tenant_isolation_ticket_messages ON ticket_messages
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY tenant_isolation_clients ON clients
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY tenant_isolation_contacts ON contacts
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY tenant_isolation_contracts ON contracts
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY tenant_isolation_devices ON devices
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY tenant_isolation_device_events ON device_events
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY tenant_isolation_kb_categories ON kb_categories
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY tenant_isolation_kb_articles ON kb_articles
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ── SEED: Demo tenant ─────────────────────────────────────────
INSERT INTO tenants (id, name, slug, plan, status, email) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Demo Automação Comercial', 'demo', 'professional', 'active',
   'admin@demo.com');

-- Admin password: Admin@123  (bcrypt hash)
INSERT INTO users (tenant_id, name, email, password, role) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Administrador', 'admin@demo.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdWnYfEJUO5xjK2',
   'admin');

INSERT INTO users (tenant_id, name, email, password, role) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'João Técnico', 'tecnico@demo.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdWnYfEJUO5xjK2',
   'technician');

INSERT INTO users (tenant_id, name, email, password, role) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Maria Gestora', 'manager@demo.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdWnYfEJUO5xjK2',
   'manager');

-- Demo clients
INSERT INTO clients (tenant_id, company_name, trade_name, cnpj, city, state, email, phone) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Supermercado Bom Preço Ltda', 'Bom Preço',
   '12.345.678/0001-90', 'São Paulo', 'SP',
   'ti@bompreco.com.br', '(11) 9999-1111'),
  ('00000000-0000-0000-0000-000000000001',
   'Farmácia Saúde Total ME', 'Saúde Total',
   '98.765.432/0001-10', 'Campinas', 'SP',
   'suporte@saudetotal.com.br', '(19) 8888-2222'),
  ('00000000-0000-0000-0000-000000000001',
   'Restaurante Sabor & Arte Ltda', 'Sabor & Arte',
   '45.678.901/0001-23', 'São Paulo', 'SP',
   'financeiro@saborarte.com.br', '(11) 7777-3333');

SELECT 'Schema created and seed data inserted!' AS status;
