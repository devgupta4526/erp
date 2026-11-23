INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'coaching' FROM subscription_plans;

CREATE TABLE coaching_batches (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 500),
  PRIMARY KEY (organization_id, id)
);
CREATE UNIQUE INDEX coaching_batch_name ON coaching_batches (organization_id, lower(name));

CREATE TABLE coaching_prospects (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  PRIMARY KEY (organization_id, id)
);

CREATE TABLE coaching_admissions (
  organization_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  prospect_id uuid NOT NULL,
  admitted_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  PRIMARY KEY (organization_id, batch_id, prospect_id),
  UNIQUE (organization_id, prospect_id),
  FOREIGN KEY (organization_id, batch_id) REFERENCES coaching_batches(organization_id, id),
  FOREIGN KEY (organization_id, prospect_id) REFERENCES coaching_prospects(organization_id, id)
);

CREATE TABLE coaching_attendance (
  organization_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  prospect_id uuid NOT NULL,
  attended_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'absent')),
  PRIMARY KEY (organization_id, batch_id, prospect_id, attended_on),
  FOREIGN KEY (organization_id, batch_id, prospect_id)
    REFERENCES coaching_admissions(organization_id, batch_id, prospect_id)
);
