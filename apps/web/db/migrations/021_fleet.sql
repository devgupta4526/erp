INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'fleet' FROM subscription_plans;

CREATE TABLE fleet_vehicles (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  registration text NOT NULL CHECK (registration ~ '^[A-Z0-9][A-Z0-9 -]{0,23}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, registration)
);

CREATE TABLE fleet_drivers (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES organization_memberships(organization_id, user_id)
);

CREATE TABLE fleet_jobs (
  organization_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  reference text NOT NULL CHECK (char_length(reference) BETWEEN 1 AND 100),
  origin text NOT NULL CHECK (char_length(origin) BETWEEN 1 AND 160),
  destination text NOT NULL CHECK (char_length(destination) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_transit','delivered','cancelled')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  departed_at timestamptz,
  delivered_at timestamptz,
  received_by text CHECK (char_length(received_by) BETWEEN 1 AND 120),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, reference),
  FOREIGN KEY (organization_id, vehicle_id) REFERENCES fleet_vehicles(organization_id, id),
  FOREIGN KEY (organization_id, driver_id) REFERENCES fleet_drivers(organization_id, user_id),
  CHECK ((status IN ('in_transit','delivered')) = (departed_at IS NOT NULL)),
  CHECK ((status = 'delivered') = (delivered_at IS NOT NULL AND received_by IS NOT NULL))
);

CREATE UNIQUE INDEX fleet_vehicle_active_job
  ON fleet_jobs (organization_id, vehicle_id) WHERE status IN ('assigned','in_transit');
CREATE UNIQUE INDEX fleet_driver_active_job
  ON fleet_jobs (organization_id, driver_id) WHERE status IN ('assigned','in_transit');
CREATE INDEX fleet_jobs_recent ON fleet_jobs (organization_id, assigned_at DESC, id DESC);
CREATE INDEX fleet_driver_jobs_recent ON fleet_jobs (organization_id, driver_id, assigned_at DESC, id DESC);
