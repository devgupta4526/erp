CREATE SEQUENCE physio_patient_number_seq AS bigint;
ALTER TABLE physio_patients
  ADD COLUMN number bigint NOT NULL DEFAULT nextval('physio_patient_number_seq'),
  ADD UNIQUE (organization_id, number),
  ADD COLUMN complaints text NOT NULL DEFAULT '' CHECK (char_length(complaints) <= 4000),
  ADD COLUMN history text NOT NULL DEFAULT '' CHECK (char_length(history) <= 4000),
  ADD COLUMN alerts text NOT NULL DEFAULT '' CHECK (char_length(alerts) <= 4000),
  ADD COLUMN emergency_contact text NOT NULL DEFAULT '' CHECK (char_length(emergency_contact) <= 254);

CREATE SEQUENCE physio_visit_token_seq AS bigint;
ALTER TABLE physio_visits
  ADD COLUMN queue_token bigint UNIQUE DEFAULT nextval('physio_visit_token_seq') NOT NULL,
  ADD COLUMN checked_in_at timestamptz,
  ADD COLUMN modality text NOT NULL DEFAULT '' CHECK (char_length(modality) <= 500),
  ADD COLUMN home_address text NOT NULL DEFAULT '' CHECK (char_length(home_address) <= 500),
  ADD COLUMN travel_distance numeric(7,2) NOT NULL DEFAULT 0 CHECK (travel_distance >= 0),
  ADD COLUMN travel_minor integer NOT NULL DEFAULT 0 CHECK (travel_minor BETWEEN 0 AND 100000000),
  ADD COLUMN consumables_minor integer NOT NULL DEFAULT 0 CHECK (consumables_minor BETWEEN 0 AND 100000000),
  ADD COLUMN reserve_from timestamptz,
  ADD COLUMN reserve_until timestamptz;

CREATE FUNCTION physio_update_reserved_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.reserve_from := NEW.starts_at - make_interval(mins => NEW.travel_minutes);
  NEW.reserve_until := NEW.ends_at + make_interval(mins => NEW.travel_minutes);
  RETURN NEW;
END;
$$;

ALTER TABLE physio_visits ADD COLUMN travel_minutes smallint NOT NULL DEFAULT 0 CHECK (travel_minutes BETWEEN 0 AND 240);
CREATE TRIGGER physio_reserve_clinician_time BEFORE INSERT OR UPDATE OF starts_at, ends_at, travel_minutes ON physio_visits
  FOR EACH ROW EXECUTE FUNCTION physio_update_reserved_time();
UPDATE physio_visits SET travel_minutes = 0;
ALTER TABLE physio_visits ALTER COLUMN reserve_from SET NOT NULL, ALTER COLUMN reserve_until SET NOT NULL,
  DROP CONSTRAINT physio_visits_organization_id_clinician_id_tstzrange_excl,
  ADD CONSTRAINT physio_clinician_dispatch_overlap EXCLUDE USING gist
    (organization_id WITH =, clinician_id WITH =, tstzrange(reserve_from, reserve_until, '[)') WITH &&) WHERE (status <> 'cancelled');

CREATE TABLE physio_exercises (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  region text NOT NULL CHECK (char_length(region) BETWEEN 1 AND 80),
  instructions text NOT NULL CHECK (char_length(instructions) BETWEEN 1 AND 4000),
  precautions text NOT NULL DEFAULT '' CHECK (char_length(precautions) <= 4000),
  PRIMARY KEY (organization_id, id)
);

CREATE TABLE physio_prescriptions (
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  exercise_id uuid NOT NULL,
  sets smallint NOT NULL CHECK (sets BETWEEN 1 AND 100),
  repetitions smallint NOT NULL CHECK (repetitions BETWEEN 1 AND 1000),
  hold_seconds smallint NOT NULL CHECK (hold_seconds BETWEEN 0 AND 3600),
  PRIMARY KEY (organization_id, patient_id, plan_id, exercise_id),
  FOREIGN KEY (organization_id, patient_id, plan_id) REFERENCES physio_plans (organization_id, patient_id, id),
  FOREIGN KEY (organization_id, exercise_id) REFERENCES physio_exercises (organization_id, id)
);
