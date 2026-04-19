BEGIN;
CREATE TABLE calendar_event_participants (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       VARCHAR     NOT NULL,
  event_id        UUID        NOT NULL,
  user_id         UUID,
  contact_id      UUID,
  external_email  VARCHAR(255),
  external_name   VARCHAR(255),
  role            VARCHAR(30) NOT NULL DEFAULT 'attendee',
  response_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_cal_participants PRIMARY KEY (id),
  CONSTRAINT fk_cal_participants_event FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
  CONSTRAINT fk_cal_participants_user  FOREIGN KEY (user_id)  REFERENCES users(id)           ON DELETE CASCADE,
  CONSTRAINT fk_cal_participants_contact FOREIGN KEY (contact_id) REFERENCES contacts(id)   ON DELETE SET NULL,
  CONSTRAINT chk_cal_participants_role CHECK (role IN ('organizer','attendee','optional')),
  CONSTRAINT chk_cal_participants_response CHECK (response_status IN ('pending','accepted','declined','tentative'))
);
CREATE INDEX idx_cal_participants_event   ON calendar_event_participants(event_id);
CREATE INDEX idx_cal_participants_user    ON calendar_event_participants(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_cal_participants_contact ON calendar_event_participants(contact_id) WHERE contact_id IS NOT NULL;
COMMIT;
