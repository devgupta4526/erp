INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'car-rental' FROM subscription_plans;

CREATE TABLE rental_vehicles (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  registration text NOT NULL CHECK (registration ~ '^[A-Z0-9][A-Z0-9 -]{0,23}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  daily_minor integer NOT NULL CHECK (daily_minor BETWEEN 1 AND 100000000),
  currency text NOT NULL CHECK (currency IN ('INR','USD','EUR','GBP')),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, registration)
);

CREATE TABLE rental_bookings (
  organization_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  renter_name text NOT NULL CHECK (char_length(renter_name) BETWEEN 1 AND 120),
  starts_on date NOT NULL,
  due_on date NOT NULL,
  daily_minor integer NOT NULL CHECK (daily_minor BETWEEN 1 AND 100000000),
  currency text NOT NULL CHECK (currency IN ('INR','USD','EUR','GBP')),
  quoted_minor bigint GENERATED ALWAYS AS ((due_on - starts_on) * daily_minor::bigint) STORED,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','out','returned','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  picked_up_at timestamptz,
  returned_at timestamptz,
  pickup_notes text CHECK (char_length(pickup_notes) BETWEEN 1 AND 1000),
  return_notes text CHECK (char_length(return_notes) BETWEEN 1 AND 1000),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, vehicle_id) REFERENCES rental_vehicles(organization_id, id),
  CHECK (due_on - starts_on BETWEEN 1 AND 365),
  CHECK ((status IN ('out','returned')) = (picked_up_at IS NOT NULL AND pickup_notes IS NOT NULL)),
  CHECK ((status = 'returned') = (returned_at IS NOT NULL AND return_notes IS NOT NULL)),
  EXCLUDE USING gist (
    organization_id WITH =,
    vehicle_id WITH =,
    daterange(starts_on, due_on, '[)') WITH &&
  ) WHERE (status <> 'cancelled')
);

CREATE UNIQUE INDEX rental_vehicle_single_handover
  ON rental_bookings (organization_id, vehicle_id) WHERE status = 'out';
CREATE INDEX rental_bookings_recent ON rental_bookings (organization_id, created_at DESC, id DESC);
