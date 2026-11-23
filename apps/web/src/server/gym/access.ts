import "server-only";
import type { PoolClient } from "pg";

export const gymEntitlement = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'gym'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;

export const today = "(now() AT TIME ZONE 'UTC')::date";

export async function lockGymWrite(db: PoolClient, scope: [string, string]) {
  const access = await db.query(`
    SELECT 1 ${gymEntitlement} AND m.role IN ('owner', 'admin') FOR SHARE OF s, p, m
  `, scope);
  return !!access.rowCount;
}

export async function auditGym(db: PoolClient, scope: [string, string], action: string, entity: string, id: string) {
  await db.query(`
    INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
    VALUES ($1, $2, $3, $4, $5)
  `, [...scope, action, entity, id]);
}

export function isGymId(value: string) {
  return /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
}
