CREATE TABLE gym_plans (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  term_days integer NOT NULL CHECK (term_days BETWEEN 1 AND 3650),
  price_minor integer NOT NULL CHECK (price_minor BETWEEN 1 AND 999999999),
  currency text NOT NULL CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP')),
  archived_at timestamptz,
  PRIMARY KEY (organization_id, id)
);

CREATE UNIQUE INDEX gym_active_plan_names ON gym_plans (organization_id, lower(name)) WHERE archived_at IS NULL;

ALTER TABLE gym_memberships ADD COLUMN plan_id uuid;
ALTER TABLE gym_memberships ADD CONSTRAINT gym_membership_plan_fk
  FOREIGN KEY (organization_id, plan_id) REFERENCES gym_plans (organization_id, id);

CREATE TABLE gym_membership_payments (
  organization_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL,
  membership_start date NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP')),
  method text NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'card', 'upi')),
  reference text NOT NULL CHECK (char_length(reference) BETWEEN 1 AND 120),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, reference),
  UNIQUE (organization_id, member_id, membership_start),
  FOREIGN KEY (organization_id, member_id, membership_start)
    REFERENCES gym_memberships (organization_id, member_id, starts_on)
);

CREATE INDEX gym_attendance_date ON gym_attendance (organization_id, attended_on);
CREATE INDEX gym_payment_recorded ON gym_membership_payments (organization_id, recorded_at DESC, id DESC);
