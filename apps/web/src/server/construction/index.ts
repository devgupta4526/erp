import "server-only";
import type { PoolClient } from "pg";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

const entitlement = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'construction'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;

export const constructionCurrencies = ["INR", "USD", "EUR", "GBP"] as const;
export const constructionPageSize = 25;
const maxLines = 250;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

type Project = { id: string; name: string; currency: string };
type Estimate = {
  project: Project | null;
  total: string;
  lines: {
    id: string;
    description: string;
    quantity: string;
    unit: string;
    rate: string;
    total: string;
  }[];
};

function field(form: FormData, name: string, max: number) {
  const value = String(form.get(name) ?? "").trim();
  return value.length <= max && !/\p{C}/u.test(value) ? value : "";
}

function parseRate(value: string) {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  const [units, fraction = ""] = value.split(".");
  const rate = BigInt(units) * 100n + BigInt(fraction.padEnd(2, "0"));
  return rate <= 1000000000n ? rate.toString() : null;
}

function parseQuantity(value: string) {
  if (!/^\d{1,7}(?:\.\d{1,3})?$/.test(value)) return null;
  const [units, fraction = ""] = value.split(".");
  const quantity = BigInt(units) * 1000n + BigInt(fraction.padEnd(3, "0"));
  return quantity > 0n && quantity <= 1000000000n ? value : null;
}

export async function listConstructionProjects(organizationId: string, page: number) {
  const session = await requireMembership(organizationId);
  const { rows } = await pool.query<{ allowed: boolean; projects: Project[] }>(`
    WITH access AS (SELECT 1 ${entitlement}), projects AS (
      SELECT id, name, currency, created_at FROM construction_projects
      WHERE organization_id = $1 AND EXISTS (SELECT 1 FROM access)
      ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed,
      coalesce((SELECT json_agg(projects ORDER BY created_at DESC, id DESC) FROM projects), '[]') AS projects
  `, [organizationId, session.userId, constructionPageSize + 1, (page - 1) * constructionPageSize]);
  return rows[0];
}

export async function readConstructionEstimate(organizationId: string, projectId: string) {
  const session = await requireMembership(organizationId);
  if (!uuid.test(projectId)) return undefined;
  const { rows } = await pool.query<Estimate>(`
    WITH project AS (
      SELECT id, name, currency FROM construction_projects
      WHERE organization_id = $1 AND id = $3 AND EXISTS (SELECT 1 ${entitlement})
    ), lines AS (
      SELECT id, description, unit, quantity::text, unit_rate_minor::text AS rate,
        line_total_minor::text AS total, created_at
      FROM construction_boq_lines
      WHERE organization_id = $1 AND project_id IN (SELECT id FROM project)
    )
    SELECT (SELECT row_to_json(project) FROM project) AS project,
      coalesce((SELECT json_agg(lines ORDER BY created_at, id) FROM lines), '[]') AS lines,
      coalesce((SELECT sum(total::numeric) FROM lines), 0)::text AS total
  `, [organizationId, session.userId, projectId]);
  return rows[0].project ? { ...rows[0], project: rows[0].project } : undefined;
}

async function audit(db: PoolClient, scope: [string, string], action: string, entityId: string) {
  await db.query(`
    INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
    VALUES ($1, $2, $3, 'construction_project', $4)
  `, [...scope, action, entityId]);
}

export async function updateConstruction(organizationId: string, projectId: string | null, form: FormData) {
  const session = await requireMembership(organizationId, ["owner", "admin"]);
  const scope: [string, string] = [organizationId, session.userId];
  const operation = form.get("operation");
  return transaction(async (db) => {
    const access = await db.query(`
      SELECT 1 ${entitlement} AND m.role IN ('owner', 'admin') FOR SHARE OF s, p, m
    `, scope);
    if (!access.rowCount) return { result: "forbidden", projectId };

    if (operation === "create" && !projectId) {
      const name = field(form, "name", 120);
      const currency = field(form, "currency", 3);
      if (!name || !constructionCurrencies.some((option) => option === currency)) {
        return { result: "invalid", projectId };
      }
      const { rows } = await db.query<{ id: string }>(`
        INSERT INTO construction_projects (organization_id, name, currency)
        VALUES ($1, $2, $3) RETURNING id
      `, [organizationId, name, currency]);
      await audit(db, scope, "construction.project.created", rows[0].id);
      return { result: "created", projectId: rows[0].id };
    }

    if (!projectId || !uuid.test(projectId)) return { result: "invalid", projectId: null };
    const args = [organizationId, projectId];
    const project = await db.query("SELECT id FROM construction_projects WHERE organization_id = $1 AND id = $2 FOR UPDATE", args);
    if (!project.rowCount) return { result: "missing", projectId: null };

    if (operation === "line") {
      const description = field(form, "description", 160);
      const unit = field(form, "unit", 20);
      const quantity = parseQuantity(field(form, "quantity", 11));
      const rate = parseRate(field(form, "rate", 11));
      if (!description || !unit || !quantity || rate === null) return { result: "invalid", projectId };
      const inserted = await db.query(`
        INSERT INTO construction_boq_lines (organization_id, project_id, description, unit, quantity, unit_rate_minor)
        SELECT $1, $2, $3, $4, $5, $6 WHERE
          (SELECT count(*) FROM construction_boq_lines WHERE organization_id = $1 AND project_id = $2) < $7
      `, [...args, description, unit, quantity, rate, maxLines]);
      if (!inserted.rowCount) return { result: "limit", projectId };
      await audit(db, scope, "construction.boq.line_added", projectId);
      return { result: "added", projectId };
    }

    if (operation === "remove") {
      const id = field(form, "lineId", 36);
      if (!uuid.test(id)) return { result: "invalid", projectId };
      const removed = await db.query(`
        DELETE FROM construction_boq_lines WHERE organization_id = $1 AND project_id = $2 AND id = $3
      `, [...args, id]);
      if (!removed.rowCount) return { result: "missing-line", projectId };
      await audit(db, scope, "construction.boq.line_removed", projectId);
      return { result: "removed", projectId };
    }
    return { result: "invalid", projectId };
  });
}
