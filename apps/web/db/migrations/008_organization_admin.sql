CREATE TABLE organization_branches (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

CREATE UNIQUE INDEX organization_branches_name
  ON organization_branches (organization_id, lower(name));

CREATE TABLE organization_invitations (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash text PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) <= 254),
  expires_at timestamptz NOT NULL,
  UNIQUE (organization_id, email)
);
