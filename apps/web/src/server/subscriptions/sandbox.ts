import "server-only";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

export function sandboxEnabled() {
  return process.env.BUSINESSOS_SANDBOX_BILLING === "true" &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.APP_ORIGIN ?? "");
}

export async function readBilling(organizationId: string) {
  const session = await requireMembership(organizationId, ["owner"]);
  const [plans, activity] = await Promise.all([
    pool.query<{ code: string; name: string; seat_limit: number | null; branch_limit: number | null }>(`
      SELECT code, name, seat_limit, branch_limit FROM subscription_plans ORDER BY seat_limit NULLS LAST, code
    `),
    pool.query<{ request_id: string; action: string; plan: string; cycle: string | null; created_at: Date }>(`
      SELECT a.request_id, a.action, p.name AS plan, a.cycle, a.created_at
      FROM subscription_activity a JOIN subscription_plans p ON p.code = a.plan_code
      WHERE a.organization_id = $1 ORDER BY a.created_at DESC, a.request_id DESC LIMIT 25
    `, [session.organizationId]),
  ]);
  return { plans: plans.rows, activity: activity.rows };
}

export async function changeSandboxSubscription(
  organizationId: string,
  input: { requestId: string; action: string; plan: string; cycle: string },
) {
  const session = await requireMembership(organizationId, ["owner"]);
  if (!sandboxEnabled()) return "disabled";
  const cancel = input.action === "cancel";
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(input.requestId) ||
      (!cancel && (input.action !== "checkout" || !["monthly", "annual"].includes(input.cycle)))) return "invalid";

  return transaction(async (db) => {
    const subscription = await db.query<{ plan_code: string }>(`
      SELECT s.plan_code
      FROM organization_subscriptions s
      JOIN organization_memberships m ON m.organization_id = s.organization_id
      WHERE s.organization_id = $1 AND m.user_id = $2 AND m.role = 'owner'
      FOR UPDATE OF s FOR SHARE OF m
    `, [organizationId, session.userId]);
    if (!subscription.rows[0]) return "forbidden";
    const prior = await db.query(
      "SELECT 1 FROM subscription_activity WHERE organization_id = $1 AND request_id = $2",
      [organizationId, input.requestId],
    );
    if (prior.rowCount) return "done";

    const plan = cancel ? subscription.rows[0].plan_code : input.plan;
    const cycle = cancel ? null : input.cycle;
    if (!cancel) {
      const capacity = await db.query<{ allowed: boolean }>(`
        SELECT (p.seat_limit IS NULL OR p.seat_limit >= (
            SELECT count(*) FROM organization_memberships WHERE organization_id = $1
          )) AND (p.branch_limit IS NULL OR p.branch_limit >= (
            SELECT count(*) FROM organization_branches WHERE organization_id = $1
          )) AS allowed
        FROM subscription_plans p WHERE p.code = $2
      `, [organizationId, plan]);
      if (!capacity.rows[0]) return "invalid";
      if (!capacity.rows[0].allowed) return "limit";
    }

    const action = cancel ? "sandbox_cancel" : "sandbox_checkout";
    await db.query(`
      WITH changed AS (
        UPDATE organization_subscriptions
        SET plan_code = $2, status = CASE WHEN $3::text IS NULL THEN 'canceled' ELSE 'active' END,
          access_until = CASE WHEN $3 IS NULL THEN now()
            WHEN status = 'active' AND plan_code = $2 AND access_until > now()
              THEN access_until + CASE WHEN $3 = 'annual' THEN interval '1 year' ELSE interval '1 month' END
            ELSE now() + CASE WHEN $3 = 'annual' THEN interval '1 year' ELSE interval '1 month' END END
        WHERE organization_id = $1 RETURNING access_until
      )
      INSERT INTO subscription_activity
        (organization_id, request_id, actor_user_id, action, plan_code, cycle, access_until)
      SELECT $1, $4, $5, $6, $2, $3, access_until FROM changed
    `, [organizationId, plan, cycle, input.requestId, session.userId, action]);
    await db.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
      VALUES ($1, $2, $3, 'organization_subscription', $1)
    `, [organizationId, session.userId, `billing.${action}`]);
    return "done";
  });
}
