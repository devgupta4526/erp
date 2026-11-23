INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'gym' FROM subscription_plans;

CREATE TABLE gym_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

CREATE INDEX gym_members_recent ON gym_members (organization_id, created_at DESC, id DESC);

CREATE TABLE gym_memberships (
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  PRIMARY KEY (organization_id, member_id, starts_on),
  FOREIGN KEY (organization_id, member_id) REFERENCES gym_members(organization_id, id)
);

CREATE TABLE gym_attendance (
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  attended_on date NOT NULL,
  PRIMARY KEY (organization_id, member_id, attended_on),
  FOREIGN KEY (organization_id, member_id) REFERENCES gym_members(organization_id, id)
);
