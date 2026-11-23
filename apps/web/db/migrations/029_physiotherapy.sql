INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'physiotherapy' FROM subscription_plans;

CREATE TABLE physio_patients (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  contact text NOT NULL DEFAULT '' CHECK (char_length(contact) <= 254),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);
CREATE UNIQUE INDEX physio_one_demo_per_workspace ON physio_patients (organization_id) WHERE is_demo;
CREATE INDEX physio_patients_by_name ON physio_patients (organization_id, lower(name), id);

CREATE TABLE physio_plans (
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  goals text NOT NULL CHECK (char_length(goals) BETWEEN 1 AND 4000),
  home_program text NOT NULL DEFAULT '' CHECK (char_length(home_program) <= 4000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, patient_id, id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES physio_patients (organization_id, id)
);

CREATE TABLE physio_visits (
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  clinician_id uuid NOT NULL REFERENCES users(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '8 hours'),
  location text NOT NULL CHECK (location IN ('clinic', 'home')),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  currency text NOT NULL CHECK (currency IN ('INR', 'USD', 'GBP', 'EUR')),
  fee_minor integer NOT NULL CHECK (fee_minor BETWEEN 1 AND 100000000),
  progress text CHECK (char_length(progress) BETWEEN 1 AND 4000),
  patient_rating smallint CHECK (patient_rating BETWEEN 0 AND 10),
  invoice_id uuid,
  PRIMARY KEY (organization_id, patient_id, id),
  UNIQUE (organization_id, invoice_id),
  FOREIGN KEY (organization_id, patient_id, plan_id) REFERENCES physio_plans (organization_id, patient_id, id),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES sales_invoices (organization_id, id),
  CHECK ((status = 'completed') = (progress IS NOT NULL)),
  CHECK (status = 'completed' OR (patient_rating IS NULL AND invoice_id IS NULL)),
  EXCLUDE USING gist (organization_id WITH =, clinician_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (status <> 'cancelled'),
  EXCLUDE USING gist (organization_id WITH =, patient_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (status <> 'cancelled')
);
CREATE INDEX physio_visits_by_date ON physio_visits (organization_id, patient_id, starts_at DESC, id);
