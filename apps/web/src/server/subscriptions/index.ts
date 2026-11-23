import "server-only";
import type { PoolClient } from "pg";
import { pool } from "@/server/db";

export async function initializeSubscription(client: PoolClient, organizationId: string) {
  await client.query(`
    INSERT INTO organization_subscriptions (organization_id, plan_code, status, access_until)
    VALUES ($1, 'starter', 'trialing', now() + interval '30 days')
  `, [organizationId]);
}

export async function getSubscription(organizationId: string) {
  const { rows } = await pool.query<{
    name: string;
    status: string;
    access_until: Date;
    has_access: boolean;
  }>(`
    SELECT p.name, s.status, s.access_until,
      (s.status IN ('trialing', 'active') AND s.access_until > now()) AS has_access
    FROM organization_subscriptions s
    JOIN subscription_plans p ON p.code = s.plan_code
    WHERE s.organization_id = $1
  `, [organizationId]);

  return rows[0] ?? null;
}

export async function listEnabledModules(organizationId: string, userId: string) {
  const { rows } = await pool.query<{ module_code: string }>(`
    SELECT p.module_code
    FROM organization_subscriptions s
    JOIN plan_modules p ON p.plan_code = s.plan_code
    JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
    WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
  `, [organizationId, userId]);

  return new Set(rows.map(({ module_code }) => module_code));
}
