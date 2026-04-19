BEGIN;
CREATE TABLE task_logs (
  id           UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    VARCHAR     NOT NULL,
  task_id      UUID        NOT NULL,
  author_id    UUID,
  author_name  VARCHAR(200),
  action       VARCHAR(50) NOT NULL,
  from_value   VARCHAR(100),
  to_value     VARCHAR(100),
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_task_logs PRIMARY KEY (id),
  CONSTRAINT fk_task_logs_task   FOREIGN KEY (task_id)   REFERENCES tasks(id)  ON DELETE CASCADE,
  CONSTRAINT fk_task_logs_author FOREIGN KEY (author_id) REFERENCES users(id)  ON DELETE SET NULL
);
CREATE INDEX idx_task_logs_task_id ON task_logs(task_id);
COMMIT;
