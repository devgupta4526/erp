INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'invoices' FROM subscription_plans;

CREATE TABLE invoice_counters (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_number bigint NOT NULL CHECK (last_number > 0)
);

CREATE TABLE sales_invoices (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_name text NOT NULL CHECK (char_length(customer_name) BETWEEN 1 AND 120),
  currency text NOT NULL CHECK (currency IN ('INR', 'USD', 'GBP', 'EUR')),
  number bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, number),
  CHECK ((number IS NULL) = (issued_at IS NULL))
);

CREATE INDEX sales_invoices_recent ON sales_invoices (organization_id, created_at DESC, id DESC);

CREATE TABLE sales_invoice_lines (
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 160),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  unit_minor integer NOT NULL CHECK (unit_minor BETWEEN 1 AND 100000000),
  PRIMARY KEY (organization_id, invoice_id, id),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES sales_invoices(organization_id, id)
);

CREATE TABLE sales_invoice_receipts (
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  reference text NOT NULL CHECK (char_length(reference) BETWEEN 1 AND 100),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, reference),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES sales_invoices(organization_id, id)
);

CREATE INDEX sales_invoice_receipts_lookup ON sales_invoice_receipts (organization_id, invoice_id);
