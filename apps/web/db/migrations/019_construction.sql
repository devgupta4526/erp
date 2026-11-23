INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'construction' FROM subscription_plans
ON CONFLICT DO NOTHING;

CREATE TABLE construction_projects (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    currency text NOT NULL CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id)
);

CREATE INDEX construction_projects_recent
    ON construction_projects (organization_id, created_at DESC, id DESC);

CREATE TABLE construction_boq_lines (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 160),
    unit text NOT NULL CHECK (char_length(unit) BETWEEN 1 AND 20),
    quantity numeric(10,3) NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
    unit_rate_minor bigint NOT NULL CHECK (unit_rate_minor BETWEEN 0 AND 1000000000),
    line_total_minor bigint GENERATED ALWAYS AS (round(quantity * unit_rate_minor)::bigint) STORED,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES construction_projects(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX construction_boq_order
    ON construction_boq_lines (organization_id, project_id, created_at, id);
