INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'events' FROM subscription_plans;

CREATE TABLE event_venues (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 100000),
  PRIMARY KEY (organization_id, id)
);

CREATE UNIQUE INDEX event_venues_name ON event_venues (organization_id, lower(name));

CREATE TABLE managed_events (
  organization_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 100000),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'canceled')),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, venue_id) REFERENCES event_venues(organization_id, id),
  EXCLUDE USING gist (
    organization_id WITH =, venue_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'planned')
);

CREATE INDEX managed_events_by_date ON managed_events (organization_id, starts_at DESC, id DESC);

CREATE TABLE event_guests (
  organization_id uuid NOT NULL,
  event_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) <= 254),
  response text NOT NULL DEFAULT 'pending' CHECK (response IN ('pending', 'confirmed', 'declined')),
  PRIMARY KEY (organization_id, event_id, id),
  UNIQUE (organization_id, event_id, email),
  FOREIGN KEY (organization_id, event_id) REFERENCES managed_events(organization_id, id)
);

CREATE INDEX event_guest_confirmations ON event_guests (organization_id, event_id) WHERE response = 'confirmed';

CREATE TABLE event_schedule_items (
  organization_id uuid NOT NULL,
  event_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  PRIMARY KEY (organization_id, event_id, id),
  FOREIGN KEY (organization_id, event_id) REFERENCES managed_events(organization_id, id),
  EXCLUDE USING gist (
    organization_id WITH =, event_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  )
);
