INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'courier' FROM subscription_plans;

CREATE TABLE courier_consignments (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  tracking_code text NOT NULL UNIQUE CHECK (tracking_code ~ '^BS-[0-9A-F]{32}$'),
  sender_name text NOT NULL CHECK (char_length(sender_name) BETWEEN 1 AND 120),
  recipient_name text NOT NULL CHECK (char_length(recipient_name) BETWEEN 1 AND 120),
  origin text NOT NULL CHECK (char_length(origin) BETWEEN 1 AND 120),
  destination text NOT NULL CHECK (char_length(destination) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'picked_up', 'in_transit', 'delivered')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

CREATE INDEX courier_recent_consignments ON courier_consignments (organization_id, created_at DESC, id DESC);

CREATE TABLE courier_consignment_events (
  organization_id uuid NOT NULL,
  consignment_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('booked', 'picked_up', 'in_transit', 'delivered')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivery_recipient text,
  PRIMARY KEY (organization_id, consignment_id, status),
  FOREIGN KEY (organization_id, consignment_id)
    REFERENCES courier_consignments (organization_id, id) ON DELETE CASCADE,
  CHECK ((status = 'delivered') = (delivery_recipient IS NOT NULL)),
  CHECK (delivery_recipient IS NULL OR char_length(delivery_recipient) BETWEEN 1 AND 120)
);
