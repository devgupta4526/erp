import "server-only";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

const entitlement = `
  FROM organization_subscriptions s JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'coaching'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
    AND m.role IN ('owner', 'admin')
`;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type Prospect = { id: string; name: string };
type Batch = { id: string; name: string; capacity: number; admissions: number };
type Learner = Prospect & { status: string | null; admitted_on: string };

export async function readCoaching(organizationId: string, batchId: string, day: string, page: number) {
  const session = await requireMembership(organizationId, ["owner", "admin"]);
  const { rows } = await pool.query<{ allowed: boolean; prospects: Prospect[]; batches: Batch[]; learners: Learner[] }>(`
    WITH scope AS (SELECT 1 ${entitlement}), batches AS (
      SELECT b.id, b.name, b.capacity, count(a.prospect_id)::int AS admissions FROM coaching_batches b
      LEFT JOIN coaching_admissions a ON a.organization_id = b.organization_id AND a.batch_id = b.id
      WHERE b.organization_id = $1 AND EXISTS (SELECT 1 FROM scope)
      GROUP BY b.id, b.name, b.capacity
    ), prospects AS (
      SELECT p.id, p.name FROM coaching_prospects p
      WHERE p.organization_id = $1 AND EXISTS (SELECT 1 FROM scope)
        AND NOT EXISTS (SELECT 1 FROM coaching_admissions a WHERE a.organization_id = p.organization_id AND a.prospect_id = p.id)
      ORDER BY lower(p.name), p.id LIMIT 26 OFFSET $5
    ), learners AS (
      SELECT p.id, p.name, a.admitted_on, d.status FROM coaching_admissions a
      JOIN coaching_prospects p ON p.organization_id = a.organization_id AND p.id = a.prospect_id
      LEFT JOIN coaching_attendance d ON d.organization_id = a.organization_id AND d.batch_id = a.batch_id
        AND d.prospect_id = a.prospect_id AND d.attended_on = $4::date
      WHERE a.organization_id = $1 AND a.batch_id = $3 AND EXISTS (SELECT 1 FROM scope)
    )
    SELECT EXISTS (SELECT 1 FROM scope) AS allowed,
      coalesce((SELECT json_agg(batches ORDER BY lower(name), id) FROM batches), '[]') AS batches,
      coalesce((SELECT json_agg(prospects ORDER BY lower(name), id) FROM prospects), '[]') AS prospects,
      coalesce((SELECT json_agg(learners ORDER BY lower(name), id) FROM learners), '[]') AS learners
  `, [organizationId, session.userId, uuid.test(batchId) ? batchId : null, day, (page - 1) * 25]);
  return rows[0];
}

export function attendanceDay(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw.startsWith("0000")) return undefined;
  const day = new Date(`${raw}T00:00:00Z`);
  return Number.isFinite(day.valueOf()) && day.toISOString().slice(0, 10) === raw ? raw : undefined;
}

export async function writeCoaching(organizationId: string, form: FormData) {
  const session = await requireMembership(organizationId, ["owner", "admin"]);
  const input = (key: string) => String(form.get(key) ?? "").trim();
  const action = input("operation");
  return transaction(async (db) => {
    const scope = await db.query(`SELECT 1 ${entitlement} FOR SHARE OF s, p, m`, [organizationId, session.userId]);
    if (!scope.rowCount) return "forbidden";
    let id: string;
    let entity = "coaching_prospect";
    if (action === "prospect" || action === "batch") {
      const name = input("name");
      if (!name || name.length > 120 || /\p{C}/u.test(name)) return "invalid";
      if (action === "prospect") {
        if (input("adult") !== "yes") return "invalid";
        const inserted = await db.query<{ id: string }>(
          "INSERT INTO coaching_prospects (organization_id, name) VALUES ($1, $2) RETURNING id", [organizationId, name],
        );
        id = inserted.rows[0].id;
      } else {
        const capacity = Number(input("capacity"));
        if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 500) return "invalid";
        const inserted = await db.query<{ id: string }>(`
          INSERT INTO coaching_batches (organization_id, name, capacity) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id
        `, [organizationId, name, capacity]);
        if (!inserted.rows[0]) return "duplicate";
        id = inserted.rows[0].id;
        entity = "coaching_batch";
      }
    } else {
      const batch = input("batchId");
      id = input("prospectId");
      if (!uuid.test(batch) || !uuid.test(id)) return "invalid";
      if (action === "admit") {
        const { rows } = await db.query<{ capacity: number }>(
          "SELECT capacity FROM coaching_batches WHERE organization_id = $1 AND id = $2 FOR UPDATE", [organizationId, batch],
        );
        if (!rows[0]) return "invalid";
        const count = await db.query<{ total: number }>(`
          SELECT count(*)::int AS total FROM coaching_admissions WHERE organization_id = $1 AND batch_id = $2
        `, [organizationId, batch]);
        if (count.rows[0].total >= rows[0].capacity) return "full";
        const admitted = await db.query(`
          INSERT INTO coaching_admissions (organization_id, batch_id, prospect_id)
          SELECT organization_id, $2::uuid, id FROM coaching_prospects WHERE organization_id = $1 AND id = $3
          ON CONFLICT (organization_id, prospect_id) DO NOTHING
        `, [organizationId, batch, id]);
        if (!admitted.rowCount) return "unavailable";
      } else if (action === "attendance") {
        const day = attendanceDay(input("day"));
        const status = input("status");
        if (!day || day > new Date().toISOString().slice(0, 10) || !["present", "absent"].includes(status)) return "invalid";
        const updated = await db.query(`
          INSERT INTO coaching_attendance (organization_id, batch_id, prospect_id, attended_on, status)
          SELECT organization_id, batch_id, prospect_id, $4::date, $5 FROM coaching_admissions
          WHERE organization_id = $1 AND batch_id = $2 AND prospect_id = $3 AND admitted_on <= $4::date
          ON CONFLICT (organization_id, batch_id, prospect_id, attended_on) DO UPDATE SET status = excluded.status
        `, [organizationId, batch, id, day, status]);
        if (!updated.rowCount) return "unavailable";
      } else return "invalid";
    }
    await db.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
      VALUES ($1, $2, $3, $4, $5)
    `, [organizationId, session.userId, `coaching.${action}`, entity, id]);
    return "done";
  });
}
