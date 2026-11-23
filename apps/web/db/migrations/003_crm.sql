CREATE TABLE crm_contacts (
  id uuid DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email text CHECK (char_length(email) <= 254),
  company text CHECK (char_length(company) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

CREATE INDEX crm_contacts_recent ON crm_contacts (organization_id, created_at DESC, id DESC);
