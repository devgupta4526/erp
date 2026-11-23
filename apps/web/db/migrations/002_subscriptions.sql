CREATE TABLE subscription_plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  seat_limit integer CHECK (seat_limit > 0),
  branch_limit integer CHECK (branch_limit > 0)
);

INSERT INTO subscription_plans (code, name, seat_limit, branch_limit) VALUES
  ('starter', 'Starter', 5, 1),
  ('growth', 'Growth', 25, 3),
  ('business', 'Business', 100, 10),
  ('enterprise', 'Enterprise', NULL, NULL);

CREATE TABLE plan_modules (
  plan_code text REFERENCES subscription_plans(code),
  module_code text,
  PRIMARY KEY (plan_code, module_code)
);

INSERT INTO plan_modules (plan_code, module_code)
SELECT code, 'crm' FROM subscription_plans;

CREATE TABLE organization_subscriptions (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES subscription_plans(code),
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  access_until timestamptz NOT NULL
);
