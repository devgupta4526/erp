CREATE TABLE crm_companies (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

CREATE UNIQUE INDEX crm_companies_name ON crm_companies (organization_id, lower(name));

CREATE TABLE crm_opportunities (
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  stage text NOT NULL DEFAULT 'qualified'
    CHECK (stage IN ('qualified', 'proposal', 'negotiation', 'won', 'lost')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, company_id, id),
  FOREIGN KEY (organization_id, company_id) REFERENCES crm_companies(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX crm_opportunities_recent ON crm_opportunities (organization_id, company_id, created_at DESC, id DESC);

CREATE TABLE crm_tasks (
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  due_on date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, company_id, opportunity_id, id),
  FOREIGN KEY (organization_id, company_id, opportunity_id)
    REFERENCES crm_opportunities(organization_id, company_id, id) ON DELETE CASCADE
);

CREATE INDEX crm_tasks_recent ON crm_tasks (organization_id, company_id, opportunity_id, created_at DESC, id DESC);
