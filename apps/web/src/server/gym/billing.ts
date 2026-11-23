import "server-only";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";
import { auditGym, gymEntitlement, isGymId, lockGymWrite, today } from "./access";

export const currencies = ["INR", "USD", "EUR", "GBP"] as const;
export const paymentMethods = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  card: "Card",
  upi: "UPI",
} as const;

type Plan = { id: string; name: string; term_days: number; price_minor: number; currency: string };
type Receipt = { id: string; reference: string; amount_minor: number; currency: string; date: string; name: string };
type Day = { date: string; visits: number };

export async function readGymBilling() {
  const session = await requireMembership();
  const { rows } = await pool.query<{ plans: Plan[]; attendance: Day[]; receipts: Receipt[] }>(`
    WITH access AS (SELECT m.role ${gymEntitlement}),
    plans AS (
      SELECT id, name, term_days, price_minor, currency
      FROM gym_plans
      WHERE organization_id = $1 AND archived_at IS NULL AND EXISTS (SELECT 1 FROM access)
    ),
    attendance AS (
      SELECT attended_on::text AS date, count(*)::integer AS visits
      FROM gym_attendance
      WHERE organization_id = $1 AND attended_on BETWEEN ${today} - 29 AND ${today}
        AND EXISTS (SELECT 1 FROM access)
      GROUP BY attended_on
    ),
    receipts AS (
      SELECT p.id, p.reference, p.amount_minor, p.currency, g.name, p.recorded_at,
        ((p.recorded_at AT TIME ZONE 'UTC')::date)::text AS date
      FROM gym_membership_payments p
      JOIN gym_members g ON g.organization_id = p.organization_id AND g.id = p.member_id
      WHERE p.organization_id = $1 AND EXISTS (SELECT 1 FROM access WHERE role IN ('owner', 'admin'))
      ORDER BY p.recorded_at DESC, p.id DESC LIMIT 25
    )
    SELECT
      coalesce((SELECT json_agg(plans ORDER BY name, id) FROM plans), '[]') AS plans,
      coalesce((SELECT json_agg(attendance ORDER BY date DESC) FROM attendance), '[]') AS attendance,
      coalesce((SELECT json_agg(receipts ORDER BY recorded_at DESC, id DESC) FROM receipts), '[]') AS receipts
  `, [session.organizationId, session.userId]);
  return rows[0];
}

export async function createGymPlan(organizationId: string, input: { name: string; days: string; amount: string; currency: string }) {
  const session = await requireMembership(organizationId);
  const scope: [string, string] = [session.organizationId, session.userId];
  const name = input.name.trim();
  const days = Number(input.days);
  const decimal = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.amount);
  const minor = decimal ? Number(decimal[1]) * 100 + Number((decimal[2] ?? "").padEnd(2, "0")) : 0;
  if (!name || name.length > 120 || name.includes("\0") ||
      !Number.isInteger(days) || days < 1 || days > 3650 || minor < 1 ||
      !currencies.some((currency) => currency === input.currency)) return "invalid-plan";

  return transaction(async (db) => {
    if (!(await lockGymWrite(db, scope))) return "forbidden";
    const result = await db.query<{ id: string }>(`
      INSERT INTO gym_plans (organization_id, name, term_days, price_minor, currency)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id
    `, [scope[0], name, days, minor, input.currency]);
    if (!result.rows[0]) return "duplicate-plan";
    await auditGym(db, scope, "gym.plan.created", "gym_plan", result.rows[0].id);
    return "plan-created";
  });
}

export async function archiveGymPlan(organizationId: string, planId: string) {
  const session = await requireMembership(organizationId);
  const scope: [string, string] = [session.organizationId, session.userId];
  if (!isGymId(planId)) return "invalid-plan";

  return transaction(async (db) => {
    if (!(await lockGymWrite(db, scope))) return "forbidden";
    const result = await db.query(`
      UPDATE gym_plans SET archived_at = now()
      WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL
    `, [scope[0], planId]);
    if (!result.rowCount) return "invalid-plan";
    await auditGym(db, scope, "gym.plan.archived", "gym_plan", planId);
    return "plan-archived";
  });
}

class PaymentReferenceUsed extends Error {}

export async function recordGymPayment(organizationId: string, input: { memberId: string; planId: string; method: string; reference: string }) {
  const session = await requireMembership(organizationId);
  const scope: [string, string] = [session.organizationId, session.userId];
  const reference = input.reference.trim();
  if (!isGymId(input.memberId) || !isGymId(input.planId) || !reference ||
      reference.length > 120 || reference.includes("\0") || !Object.hasOwn(paymentMethods, input.method)) {
    return "invalid-payment";
  }

  try {
    return await transaction(async (db) => {
      if (!(await lockGymWrite(db, scope))) return "forbidden";
      const member = await db.query(`
        SELECT 1 FROM gym_members WHERE organization_id = $1 AND id = $2 FOR UPDATE
      `, [scope[0], input.memberId]);
      if (!member.rowCount) return "invalid-payment";
      const plan = await db.query<Pick<Plan, "id" | "term_days" | "price_minor" | "currency">>(`
        SELECT id, term_days, price_minor, currency FROM gym_plans
        WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL FOR SHARE
      `, [scope[0], input.planId]);
      const selected = plan.rows[0];
      if (!selected) return "invalid-plan";

      const result = await db.query<{ id: string }>(`
        WITH next_start AS (
          SELECT GREATEST(${today}, max(ends_on) + 1) AS day
          FROM gym_memberships WHERE organization_id = $1 AND member_id = $2
        ), membership AS (
          INSERT INTO gym_memberships (organization_id, member_id, starts_on, ends_on, plan_id)
          SELECT $1, $2, day, day + ($4::integer - 1), $3 FROM next_start RETURNING starts_on
        )
        INSERT INTO gym_membership_payments
          (organization_id, member_id, membership_start, amount_minor, currency, method, reference)
        SELECT $1, $2, starts_on, $5, $6, $7, $8 FROM membership
        ON CONFLICT (organization_id, reference) DO NOTHING RETURNING id
      `, [scope[0], input.memberId, selected.id, selected.term_days, selected.price_minor,
        selected.currency, input.method, reference]);
      if (!result.rows[0]) throw new PaymentReferenceUsed();
      await auditGym(db, scope, "gym.payment.recorded", "gym_membership_payment", result.rows[0].id);
      return "payment-recorded";
    });
  } catch (error) {
    if (error instanceof PaymentReferenceUsed) return "duplicate-reference";
    throw error;
  }
}
