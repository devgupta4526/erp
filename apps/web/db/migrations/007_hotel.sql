CREATE EXTENSION IF NOT EXISTS btree_gist;

INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'hotel' FROM subscription_plans;

CREATE TABLE hotel_rooms (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,23}$'),
  nightly_rate_cents integer NOT NULL CHECK (nightly_rate_cents BETWEEN 1 AND 10000000),
  currency text NOT NULL CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP')),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, code)
);

CREATE TABLE hotel_reservations (
  organization_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  guest_name text NOT NULL CHECK (char_length(guest_name) BETWEEN 1 AND 120),
  arrival date NOT NULL,
  departure date NOT NULL,
  nightly_rate_cents integer NOT NULL CHECK (nightly_rate_cents BETWEEN 1 AND 10000000),
  currency text NOT NULL CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP')),
  lodging_charge_cents bigint GENERATED ALWAYS AS ((departure - arrival) * nightly_rate_cents::bigint) STORED,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'checked_in', 'checked_out', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, room_id) REFERENCES hotel_rooms(organization_id, id) ON DELETE CASCADE,
  CHECK (departure - arrival BETWEEN 1 AND 365),
  CHECK ((checked_in_at IS NOT NULL) = (status IN ('checked_in', 'checked_out'))),
  CHECK ((checked_out_at IS NOT NULL) = (status = 'checked_out')),
  CONSTRAINT hotel_no_overlapping_reservations EXCLUDE USING gist (
    organization_id WITH =,
    room_id WITH =,
    daterange(arrival, departure, '[)') WITH &&
  ) WHERE (status IN ('reserved', 'checked_in', 'checked_out'))
);

CREATE UNIQUE INDEX hotel_room_single_occupant
  ON hotel_reservations (organization_id, room_id) WHERE status = 'checked_in';

CREATE INDEX hotel_recent_reservations ON hotel_reservations (organization_id, created_at DESC, id DESC);
