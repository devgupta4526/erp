import "server-only";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

const access = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'scheduling'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;

function utcInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 16) === value ? date : undefined;
}

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type Appointment = {
  id: string; subject: string; assignee: string; starts_at: string; ends_at: string; status: string;
};

export async function readSchedule(organizationId: string, day: string) {
  const session = await requireMembership(organizationId);
  const start = utcInput(`${day}T00:00`) ?? new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const { rows } = await pool.query<{
    allowed: boolean;
    appointments: Appointment[];
    staff: { id: string; name: string }[];
  }>(`
    WITH enabled AS (SELECT m.role ${access}),
    items AS (
      SELECT a.id, a.subject, u.name AS assignee, a.starts_at, a.ends_at, a.status
      FROM scheduled_appointments a JOIN users u ON u.id = a.assignee_user_id
      WHERE a.organization_id = $1 AND exists (
        SELECT 1 FROM enabled WHERE role IN ('owner', 'admin') OR a.assignee_user_id = $2
      ) AND a.starts_at < ($3::timestamptz + interval '24 hours') AND a.ends_at > $3
      ORDER BY a.starts_at, a.id LIMIT 101
    ), staff AS (
      SELECT u.id, u.name FROM organization_memberships s JOIN users u ON u.id = s.user_id
      WHERE s.organization_id = $1 AND exists (SELECT 1 FROM enabled WHERE role IN ('owner', 'admin'))
      ORDER BY lower(u.name), u.id
    )
    SELECT exists (SELECT 1 FROM enabled) AS allowed,
      coalesce((SELECT json_agg(items ORDER BY starts_at, id) FROM items), '[]') AS appointments,
      coalesce((SELECT json_agg(staff ORDER BY lower(name), id) FROM staff), '[]') AS staff
  `, [organizationId, session.userId, start.toISOString()]);
  return { ...rows[0], day: start.toISOString().slice(0, 10) };
}

export async function updateSchedule(organizationId: string, form: FormData) {
  const session = await requireMembership(organizationId, ["owner", "admin"]);
  const operation = form.get("operation");
  try {
    return await transaction(async (db) => {
      const authorized = await db.query(
        `SELECT 1 ${access} AND m.role IN ('owner', 'admin') FOR SHARE OF s, p, m`,
        [organizationId, session.userId],
      );
      if (!authorized.rowCount) return "forbidden";
      let id: string;
      if (operation === "book") {
        const assignee = String(form.get("assignee") ?? "");
        const subject = String(form.get("subject") ?? "").trim();
        const start = utcInput(String(form.get("start") ?? ""));
        const end = utcInput(String(form.get("end") ?? ""));
        if (!uuid.test(assignee) || !subject || subject.length > 120 || /\p{C}/u.test(subject) ||
          !start || !end || end <= start || end.valueOf() - start.valueOf() > 86400000) return "invalid";
        const created = await db.query<{ id: string }>(`
          INSERT INTO scheduled_appointments (organization_id, assignee_user_id, subject, starts_at, ends_at)
          SELECT organization_id, user_id, $3, $4, $5
          FROM organization_memberships WHERE organization_id = $1 AND user_id = $2
          RETURNING id
        `, [organizationId, assignee, subject, start, end]);
        if (!created.rows[0]) return "invalid";
        id = created.rows[0].id;
      } else {
        id = String(form.get("id") ?? "");
        if (!uuid.test(id) || (operation !== "complete" && operation !== "cancel")) return "invalid";
        const result = await db.query(`
          UPDATE scheduled_appointments SET status = $3
          WHERE organization_id = $1 AND id = $2 AND status = 'scheduled'
            AND ($3 = 'canceled' OR starts_at <= now())
        `, [organizationId, id, operation === "complete" ? "completed" : "canceled"]);
        if (!result.rowCount) return "unavailable";
      }
      await db.query(`
        INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
        VALUES ($1, $2, $3, 'appointment', $4)
      `, [organizationId, session.userId, `appointments.${operation}`, id]);
      return "done";
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23P01") return "overlap";
    throw error;
  }
}
