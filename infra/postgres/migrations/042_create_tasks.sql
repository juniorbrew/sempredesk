BEGIN;
CREATE TABLE tasks (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR     NOT NULL,
  title            VARCHAR(255) NOT NULL,
  description      TEXT,
  status           VARCHAR(30) NOT NULL DEFAULT 'pending',
  priority         VARCHAR(20) NOT NULL DEFAULT 'medium',
  due_at           TIMESTAMPTZ,
  reminder_at      TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  assigned_user_id UUID,
  department_id    UUID,
  ticket_id        UUID,
  contact_id       UUID,
  client_id        UUID,
  calendar_event_id UUID,
  origin           VARCHAR(30) NOT NULL DEFAULT 'manual',
  checklist        JSONB,
  notes            TEXT,
  metadata         JSONB,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_tasks PRIMARY KEY (id),
  CONSTRAINT fk_tasks_ticket   FOREIGN KEY (ticket_id)   REFERENCES tickets(id)   ON DELETE SET NULL,
  CONSTRAINT fk_tasks_contact  FOREIGN KEY (contact_id)  REFERENCES contacts(id)  ON DELETE SET NULL,
  CONSTRAINT fk_tasks_client   FOREIGN KEY (client_id)   REFERENCES clients(id)   ON DELETE SET NULL,
  CONSTRAINT fk_tasks_user     FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_dept     FOREIGN KEY (department_id) REFERENCES ticket_settings(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_event    FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_created_by FOREIGN KEY (created_by) REFERENCES users(id)    ON DELETE SET NULL,
  CONSTRAINT chk_tasks_status   CHECK (status IN ('pending','in_progress','completed','cancelled')),
  CONSTRAINT chk_tasks_priority CHECK (priority IN ('low','medium','high','critical')),
  CONSTRAINT chk_tasks_origin   CHECK (origin IN ('manual','ticket','sla','sync'))
);
CREATE INDEX idx_tasks_tenant_status ON tasks(tenant_id, status);
CREATE INDEX idx_tasks_assigned_user ON tasks(assigned_user_id) WHERE assigned_user_id IS NOT NULL;
CREATE INDEX idx_tasks_ticket        ON tasks(ticket_id)        WHERE ticket_id IS NOT NULL;
CREATE INDEX idx_tasks_due_at        ON tasks(tenant_id, due_at) WHERE due_at IS NOT NULL;
CREATE INDEX idx_tasks_department    ON tasks(department_id)    WHERE department_id IS NOT NULL;
COMMENT ON TABLE tasks IS 'Tarefas internas. Multi-tenant. Vinculável a tickets, contatos, clientes e eventos de agenda.';
COMMIT;
