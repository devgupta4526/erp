import "server-only";

export const crmAccessPredicate = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'crm'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;
