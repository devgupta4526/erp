CREATE TABLE practice_documents (
  organization_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  media_type text NOT NULL CHECK (media_type IN ('application/pdf', 'text/plain')),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 524288),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, engagement_id, id),
  FOREIGN KEY (organization_id, engagement_id) REFERENCES practice_engagements(organization_id, id)
);

CREATE INDEX practice_documents_created
  ON practice_documents (organization_id, engagement_id, created_at, id);
