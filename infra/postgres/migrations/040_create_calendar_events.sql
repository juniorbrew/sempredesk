-- Migration 040 — Tabela: calendar_events
-- Módulo Agenda: eventos de calendário interno, vinculáveis a tickets/contatos/clientes.
--
-- O que faz:
--   Cria a tabela calendar_events com suporte a:
--   - eventos internos e de retorno a cliente
--   - atribuição a usuário e/ou departamento
--   - vínculo opcional com ticket, contato e cliente
--   - campo de provedor externo (Google/Outlook) para uso na Fase 4
--
-- O que NÃO faz:
--   - Não altera nenhuma tabela existente
--   - Não cria índices CONCURRENTLY (tabela nova, sem dados, sem risco)
--
-- Rollback:
--   DROP TABLE IF EXISTS calendar_events CASCADE;

BEGIN;

CREATE TABLE calendar_events (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             VARCHAR     NOT NULL,

  -- Dados do evento
  title                 VARCHAR(255) NOT NULL,
  description           TEXT,
  location              VARCHAR(500),
  notes                 TEXT,

  -- Temporalidade
  starts_at             TIMESTAMPTZ NOT NULL,
  ends_at               TIMESTAMPTZ NOT NULL,
  timezone              VARCHAR(60)  NOT NULL DEFAULT 'America/Sao_Paulo',
  all_day               BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Classificação
  status                VARCHAR(30)  NOT NULL DEFAULT 'scheduled',
    -- scheduled | confirmed | cancelled | completed | rescheduled
  event_type            VARCHAR(50)  NOT NULL DEFAULT 'internal',
    -- internal | client_return | sla_reminder | meeting | sync_google | sync_outlook
  origin                VARCHAR(30)  NOT NULL DEFAULT 'manual',
    -- manual | ticket | sla | sync_google | sync_outlook

  -- Atribuição interna (opcionais)
  assigned_user_id      UUID,
  department_id         UUID,

  -- Vínculos com entidades existentes (todos opcionais)
  ticket_id             UUID,
  contact_id            UUID,
  client_id             UUID,

  -- Integração com provedor externo (Google/Outlook — Fase 4)
  provider              VARCHAR(20),
    -- google | outlook | null
  provider_event_id     VARCHAR(500),
  provider_calendar_id  VARCHAR(500),
  provider_sync_token   VARCHAR(500),

  metadata              JSONB,
  created_by            UUID,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_calendar_events PRIMARY KEY (id),

  CONSTRAINT fk_calendar_events_ticket_id
    FOREIGN KEY (ticket_id)  REFERENCES tickets(id)          ON DELETE SET NULL,
  CONSTRAINT fk_calendar_events_contact_id
    FOREIGN KEY (contact_id) REFERENCES contacts(id)         ON DELETE SET NULL,
  CONSTRAINT fk_calendar_events_client_id
    FOREIGN KEY (client_id)  REFERENCES clients(id)          ON DELETE SET NULL,
  CONSTRAINT fk_calendar_events_assigned_user
    FOREIGN KEY (assigned_user_id) REFERENCES users(id)      ON DELETE SET NULL,
  CONSTRAINT fk_calendar_events_department
    FOREIGN KEY (department_id) REFERENCES ticket_settings(id) ON DELETE SET NULL,
  CONSTRAINT fk_calendar_events_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)            ON DELETE SET NULL,

  CONSTRAINT chk_calendar_events_dates
    CHECK (ends_at >= starts_at),
  CONSTRAINT chk_calendar_events_status
    CHECK (status IN ('scheduled','confirmed','cancelled','completed','rescheduled')),
  CONSTRAINT chk_calendar_events_origin
    CHECK (origin IN ('manual','ticket','sla','sync_google','sync_outlook'))
);

CREATE INDEX idx_calendar_events_tenant_starts
  ON calendar_events(tenant_id, starts_at);
CREATE INDEX idx_calendar_events_assigned_user
  ON calendar_events(assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;
CREATE INDEX idx_calendar_events_ticket
  ON calendar_events(ticket_id)
  WHERE ticket_id IS NOT NULL;
CREATE INDEX idx_calendar_events_status
  ON calendar_events(tenant_id, status);
CREATE INDEX idx_calendar_events_provider
  ON calendar_events(provider, provider_event_id)
  WHERE provider IS NOT NULL;

COMMENT ON TABLE calendar_events IS
  'Eventos de agenda do sistema. Multi-tenant. Vinculável a tickets, contatos e clientes.
   Suporte a sincronização futura com Google Calendar e Microsoft Outlook (Fase 4).';

COMMIT;
