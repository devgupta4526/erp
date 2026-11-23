INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'scheduling' FROM subscription_plans;

CREATE TABLE scheduled_appointments (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assignee_user_id uuid NOT NULL,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 120),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'canceled')),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, assignee_user_id)
    REFERENCES organization_memberships(organization_id, user_id),
  EXCLUDE USING gist (
    organization_id WITH =,
    assignee_user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status <> 'canceled')
);

CREATE INDEX scheduled_appointments_calendar
  ON scheduled_appointments (organization_id, starts_at, id);
