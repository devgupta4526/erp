INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'inventory' FROM subscription_plans;

CREATE TABLE inventory_products (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sku text NOT NULL CHECK (sku ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand BETWEEN 0 AND 1000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, sku)
);

CREATE TABLE inventory_movements (
  organization_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('receipt', 'issue')),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000000),
  balance_after integer NOT NULL CHECK (balance_after BETWEEN 0 AND 1000000000),
  reference text NOT NULL CHECK (char_length(reference) BETWEEN 1 AND 120),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, product_id, reference),
  FOREIGN KEY (organization_id, product_id) REFERENCES inventory_products (organization_id, id)
);

CREATE INDEX inventory_movements_recent ON inventory_movements (organization_id, recorded_at DESC, id DESC);
