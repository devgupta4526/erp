import "server-only";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

export const engagementKinds = { audit: "Audit", bookkeeping: "Bookkeeping", tax_advisory: "Tax advisory" } as const;
export const engagementStatuses = { open: "Open", review: "In review", approved: "Approved", closed: "Closed" } as const;

export const practiceEntitlement = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'accounting-practice'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;
const managers = "m.role IN ('owner', 'admin')";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

type Engagement = {
  id: string;
  title: string;
  kind: keyof typeof engagementKinds;
  status: keyof typeof engagementStatuses;
  deadline: string;
  company: string;
  assignee: string;
};

type EngagementTask = { id: string; title: string; due_on: string; completed: boolean };

const projection = `
  e.id, e.title, e.kind, e.status, to_char(e.deadline, 'YYYY-MM-DD') AS deadline,
  c.name AS company, u.name AS assignee
`;
const relationships = `
  FROM practice_engagements e
  JOIN crm_companies c ON c.organization_id = e.organization_id AND c.id = e.company_id
  JOIN users u ON u.id = e.assignee_user_id
`;

export async function readPractice(organizationId: string, page: number, pendingOnly: boolean) {
  const session = await requireMembership(organizationId);
  const { rows } = await pool.query<{
    allowed: boolean;
    can_manage: boolean;
    engagements: Engagement[];
    staff: { id: string; name: string }[];
    companies: { id: string; name: string }[];
  }>(`
    WITH access AS (SELECT ${managers} AS can_manage ${practiceEntitlement}),
    engagements AS (
      SELECT ${projection} ${relationships}
      WHERE e.organization_id = $1 AND ($4 = false OR e.status <> 'closed')
        AND EXISTS (SELECT 1 FROM access WHERE can_manage OR e.assignee_user_id = $2)
      ORDER BY e.deadline, e.id LIMIT 26 OFFSET $3
    ),
    staff AS (
      SELECT u.id, u.name FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1 AND EXISTS (SELECT 1 FROM access WHERE can_manage)
      ORDER BY lower(u.name), u.id
    ),
    companies AS (
      SELECT c.id, c.name FROM crm_companies c
      WHERE c.organization_id = $1 AND EXISTS (SELECT 1 FROM access WHERE can_manage)
      ORDER BY lower(c.name), c.id
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed,
      EXISTS (SELECT 1 FROM access WHERE can_manage) AS can_manage,
      coalesce((SELECT json_agg(engagements ORDER BY deadline, id) FROM engagements), '[]') AS engagements,
      coalesce((SELECT json_agg(staff ORDER BY lower(name), id) FROM staff), '[]') AS staff,
      coalesce((SELECT json_agg(companies ORDER BY lower(name), id) FROM companies), '[]') AS companies
  `, [organizationId, session.userId, (page - 1) * 25, pendingOnly]);
  return rows[0];
}

export async function readEngagement(organizationId: string, id: string) {
  const session = await requireMembership(organizationId);
  if (!uuid.test(id)) return undefined;
  const { rows } = await pool.query<Engagement & {
    can_manage: boolean;
    completion_reference: string | null;
    approver: string | null;
    tasks: EngagementTask[];
    documents: { id: string; name: string; bytes: number }[];
  }>(`
    WITH access AS (SELECT ${managers} AS can_manage ${practiceEntitlement})
    SELECT ${projection}, access.can_manage, e.completion_reference, reviewer.name AS approver,
      coalesce((SELECT json_agg(tasks ORDER BY due_on, id) FROM (
        SELECT t.id, t.title, to_char(t.due_on, 'YYYY-MM-DD') AS due_on, (t.completed_at IS NOT NULL) AS completed
        FROM practice_engagement_tasks t WHERE t.organization_id = e.organization_id AND t.engagement_id = e.id
      ) tasks), '[]') AS tasks,
      coalesce((SELECT json_agg(documents ORDER BY created_at, id) FROM (
        SELECT d.id, d.name, octet_length(d.content) AS bytes, d.created_at
        FROM practice_documents d WHERE d.organization_id = e.organization_id AND d.engagement_id = e.id
      ) documents), '[]') AS documents
    ${relationships}
    LEFT JOIN users reviewer ON reviewer.id = e.approved_by_user_id CROSS JOIN access
    WHERE e.organization_id = $1 AND e.id = $3 AND (access.can_manage OR e.assignee_user_id = $2)
  `, [organizationId, session.userId, id]);
  return rows[0];
}

function field(form: FormData, key: string, length: number) {
  const raw = form.get(key);
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  return text.length <= length && !/\p{C}/u.test(text) ? text : "";
}

function dateField(form: FormData, key: string) {
  const date = field(form, key, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const time = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(time.valueOf()) && time.toISOString().slice(0, 10) === date && date >= "1900-01-01" ? date : "";
}

export async function updateEngagement(organizationId: string, engagementId: string | null, form: FormData) {
  const session = await requireMembership(organizationId);
  const operation = field(form, "operation", 32);
  const result = (status: string, id = engagementId) => ({ status, id });

  return transaction(async (db) => {
    const permission = await db.query<{ can_manage: boolean }>(`
      SELECT ${managers} AS can_manage ${practiceEntitlement} FOR SHARE OF s, p, m
    `, [organizationId, session.userId]);
    const access = permission.rows[0];
    if (!access) return result("forbidden", null);
    let id: string;
    if (operation === "create" && !engagementId) {
      if (!access.can_manage) return result("forbidden", null);
      const company = field(form, "company", 36);
      const assignee = field(form, "assignee", 36);
      const title = field(form, "title", 140);
      const kind = field(form, "kind", 20);
      const deadline = dateField(form, "deadline");
      if (!uuid.test(company) || !uuid.test(assignee) || !title || !Object.hasOwn(engagementKinds, kind) || !deadline) {
        return result("invalid");
      }
      const created = await db.query<{ id: string }>(`
        INSERT INTO practice_engagements (organization_id, company_id, assignee_user_id, title, kind, deadline)
        SELECT c.organization_id, c.id, m.user_id, $4, $5, $6
        FROM crm_companies c JOIN organization_memberships m ON m.organization_id = c.organization_id AND m.user_id = $3
        WHERE c.organization_id = $1 AND c.id = $2 RETURNING id
      `, [organizationId, company, assignee, title, kind, deadline]);
      if (!created.rows[0]) return result("invalid");
      id = created.rows[0].id;
    } else {
      if (!engagementId || !uuid.test(engagementId)) return result("invalid", null);
      id = engagementId;
      const scope = [organizationId, id];
      const locked = await db.query<{
        status: keyof typeof engagementStatuses;
        deadline: string;
        assignee_user_id: string;
      }>(`
        SELECT status, to_char(deadline, 'YYYY-MM-DD') AS deadline, assignee_user_id
        FROM practice_engagements WHERE organization_id = $1 AND id = $2
          AND ($3::boolean OR assignee_user_id = $4)
        FOR UPDATE
      `, [...scope, access.can_manage, session.userId]);
      const engagement = locked.rows[0];
      if (!engagement) return result("forbidden", null);

      if (operation === "add-task") {
        if (!access.can_manage) return result("forbidden");
        if (engagement.status !== "open") return result("state");
        const title = field(form, "title", 140);
        const due = dateField(form, "due");
        if (!title || !due || due > engagement.deadline) return result("invalid");
        const written = await db.query(`
          INSERT INTO practice_engagement_tasks (organization_id, engagement_id, title, due_on)
          SELECT $1, $2, $3, $4 WHERE (
            SELECT count(*) FROM practice_engagement_tasks WHERE organization_id = $1 AND engagement_id = $2
          ) < 100
        `, [...scope, title, due]);
        if (!written.rowCount) return result("limit");
      } else if (operation === "complete-task") {
        if (engagement.status !== "open") return result("state");
        const task = field(form, "task", 36);
        if (!uuid.test(task)) return result("invalid");
        const written = await db.query(`
          UPDATE practice_engagement_tasks SET completed_at = now()
          WHERE organization_id = $1 AND engagement_id = $2 AND id = $3 AND completed_at IS NULL
        `, [...scope, task]);
        if (!written.rowCount) return result("state");
      } else if (operation === "submit") {
        if (engagement.status !== "open") return result("state");
        const written = await db.query(`
          UPDATE practice_engagements SET status = 'review' WHERE organization_id = $1 AND id = $2
            AND NOT EXISTS (
              SELECT 1 FROM practice_engagement_tasks
              WHERE organization_id = $1 AND engagement_id = $2 AND completed_at IS NULL
            )
        `, scope);
        if (!written.rowCount) return result("unfinished");
      } else if (operation === "approve" || operation === "return") {
        if (!access.can_manage) return result("forbidden");
        if (engagement.status !== "review") return result("state");
        if (operation === "approve") {
          if (engagement.assignee_user_id === session.userId) return result("self-review");
          await db.query(`
            UPDATE practice_engagements SET status = 'approved', approved_by_user_id = $3, approved_at = now()
            WHERE organization_id = $1 AND id = $2
          `, [...scope, session.userId]);
        } else {
          await db.query("UPDATE practice_engagements SET status = 'open' WHERE organization_id = $1 AND id = $2", scope);
        }
      } else if (operation === "close") {
        if (!access.can_manage) return result("forbidden");
        if (engagement.status !== "approved") return result("state");
        const reference = field(form, "reference", 120);
        if (!reference) return result("invalid");
        await db.query(`
          UPDATE practice_engagements SET status = 'closed', completion_reference = $3, closed_at = now()
          WHERE organization_id = $1 AND id = $2
        `, [...scope, reference]);
      } else {
        return result("invalid");
      }
    }

    await db.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
      VALUES ($1, $2, $3, 'practice_engagement', $4)
    `, [organizationId, session.userId, `practice.${operation}`, id]);
    return result("done", id);
  });
}
