CREATE TABLE subscription_activity (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('sandbox_checkout', 'sandbox_cancel')),
  plan_code text NOT NULL REFERENCES subscription_plans(code),
  cycle text CHECK (cycle IN ('monthly', 'annual')),
  access_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, request_id)
);

CREATE INDEX subscription_activity_recent
  ON subscription_activity (organization_id, created_at DESC, request_id DESC);
