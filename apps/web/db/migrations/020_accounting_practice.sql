INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'accounting-practice' FROM subscription_plans;

CREATE TABLE practice_engagements (
  organization_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  assignee_user_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  kind text NOT NULL CHECK (kind IN ('audit', 'bookkeeping', 'tax_advisory')),
  deadline date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'review', 'approved', 'closed')),
  completion_reference text CHECK (char_length(completion_reference) BETWEEN 1 AND 120),
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, company_id) REFERENCES crm_companies(organization_id, id),
  FOREIGN KEY (organization_id, assignee_user_id) REFERENCES organization_memberships(organization_id, user_id),
  CHECK ((status IN ('approved', 'closed')) = (approved_at IS NOT NULL)),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CHECK ((status = 'closed') = (completion_reference IS NOT NULL))
);

CREATE INDEX practice_engagements_deadline
  ON practice_engagements (organization_id, deadline, id);
CREATE INDEX practice_engagements_assignee
  ON practice_engagements (organization_id, assignee_user_id, deadline, id);

CREATE TABLE practice_engagement_tasks (
  organization_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  due_on date NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (organization_id, engagement_id, id),
  FOREIGN KEY (organization_id, engagement_id) REFERENCES practice_engagements(organization_id, id)
);
