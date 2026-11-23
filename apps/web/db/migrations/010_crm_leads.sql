ALTER TABLE crm_contacts ADD COLUMN company_id uuid;

ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_company
  FOREIGN KEY (organization_id, company_id)
  REFERENCES crm_companies (organization_id, id) ON DELETE SET NULL (company_id);

CREATE INDEX crm_contacts_company_idx ON crm_contacts (organization_id, company_id);

CREATE TABLE crm_leads (
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  email text CHECK (char_length(email) <= 254),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, company_id, id),
  FOREIGN KEY (organization_id, company_id) REFERENCES crm_companies (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX crm_leads_recent ON crm_leads (organization_id, company_id, created_at DESC, id DESC);

ALTER TABLE crm_opportunities ADD COLUMN lead_id uuid, ADD COLUMN contact_id uuid;

ALTER TABLE crm_opportunities
  ADD CONSTRAINT crm_opportunities_lead_unique UNIQUE (organization_id, company_id, lead_id),
  ADD CONSTRAINT crm_opportunities_lead
    FOREIGN KEY (organization_id, company_id, lead_id)
    REFERENCES crm_leads (organization_id, company_id, id),
  ADD CONSTRAINT crm_opportunities_contact
    FOREIGN KEY (organization_id, contact_id) REFERENCES crm_contacts (organization_id, id)
    ON DELETE SET NULL (contact_id);

CREATE INDEX crm_opportunities_contact_idx ON crm_opportunities (organization_id, contact_id);
