import "server-only";
import type { PoolClient } from "pg";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

export const designPageSize = 25;
const layerLimit = 70;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

const entitlement = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'design'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;

export type DesignProject = { id: string; name: string; width: number; height: number; background: string };
export type DesignLayer = {
  id: string; layer_order: number; kind: "rectangle" | "text"; x: number; y: number;
  width: number; height: number; color: string; content: string | null; font_size: number | null; revision: number;
};

export async function listDesignProjects(organizationId: string, page: number) {
  const session = await requireMembership(organizationId);
  const { rows } = await pool.query<{ allowed: boolean; projects: DesignProject[] }>(`
    WITH access AS (SELECT 1 ${entitlement}), projects AS (
      SELECT id, name, width, height, background, created_at FROM design_projects
      WHERE organization_id = $1 AND EXISTS (SELECT 1 FROM access)
      ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed,
      coalesce((SELECT json_agg(projects ORDER BY created_at DESC, id DESC) FROM projects), '[]') AS projects
  `, [organizationId, session.userId, designPageSize + 1, (page - 1) * designPageSize]);
  return rows[0];
}

export async function readDesignProject(organizationId: string, projectId: string) {
  const session = await requireMembership(organizationId);
  if (!uuid.test(projectId)) return undefined;
  const { rows } = await pool.query<DesignProject & { layers: DesignLayer[] }>(`
    SELECT id, name, width, height, background,
      coalesce((
        SELECT json_agg(layer ORDER BY layer_order) FROM (
          SELECT id, layer_order, kind, x, y, width, height, color, content, font_size, revision
          FROM design_layers WHERE organization_id = $1 AND project_id = d.id
        ) layer
      ), '[]') AS layers
    FROM design_projects d
    WHERE organization_id = $1 AND id = $3 AND EXISTS (SELECT 1 ${entitlement})
  `, [organizationId, session.userId, projectId]);
  return rows[0];
}

function whole(form: FormData, name: string, min: number, max: number) {
  const value = String(form.get(name) ?? "");
  if (!/^\d{1,10}$/.test(value)) return null;
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

function color(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").toUpperCase();
  return /^#[A-F0-9]{6}$/.test(value) ? value : null;
}

function readLayer(form: FormData, kind: string, project: DesignProject) {
  if (kind !== "text" && kind !== "rectangle") return null;
  const x = whole(form, "x", 0, project.width - 1);
  const y = whole(form, "y", 0, project.height - 1);
  const width = whole(form, "width", 1, project.width);
  const height = whole(form, "height", 1, project.height);
  const fill = color(form, "color");
  if (x === null || y === null || width === null || height === null || !fill ||
      x + width > project.width || y + height > project.height) return null;
  if (kind === "rectangle") return { x, y, width, height, fill, content: null, fontSize: null };
  const content = String(form.get("content") ?? "").trim();
  const fontSize = whole(form, "fontSize", 8, 200);
  if (!content || content.length > 240 || /\p{Cc}/u.test(content) || fontSize === null) return null;
  return { x, y, width, height, fill, content, fontSize };
}

async function audit(db: PoolClient, scope: [string, string], action: string, projectId: string) {
  await db.query(`
    INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
    VALUES ($1, $2, $3, 'design_project', $4)
  `, [...scope, `design.${action}`, projectId]);
}

export async function updateDesign(organizationId: string, projectId: string | null, form: FormData) {
  const session = await requireMembership(organizationId, ["owner", "admin"]);
  const scope: [string, string] = [organizationId, session.userId];
  const operation = form.get("operation");
  const outcome = (result: string, id = projectId) => ({ result, projectId: id });
  return transaction(async (db) => {
    const access = await db.query(`
      SELECT 1 ${entitlement} AND m.role IN ('owner', 'admin') FOR SHARE OF s, p, m
    `, scope);
    if (!access.rowCount) return outcome("forbidden", null);
    if (!projectId && operation === "create") {
      const name = String(form.get("name") ?? "").trim();
      const width = whole(form, "width", 64, 2048);
      const height = whole(form, "height", 64, 2048);
      const background = color(form, "background");
      if (!name || name.length > 120 || /\p{Cc}/u.test(name) || !width || !height || !background) return outcome("invalid");
      const { rows } = await db.query<{ id: string }>(`
        INSERT INTO design_projects (organization_id, name, width, height, background)
        VALUES ($1, $2, $3, $4, $5) RETURNING id
      `, [organizationId, name, width, height, background]);
      await audit(db, scope, "project_created", rows[0].id);
      return outcome("created", rows[0].id);
    }

    if (!projectId || !uuid.test(projectId)) return outcome("invalid", null);
    const args = [organizationId, projectId];
    const { rows: projects } = await db.query<DesignProject>(`
      SELECT id, name, width, height, background FROM design_projects
      WHERE organization_id = $1 AND id = $2 FOR UPDATE
    `, args);
    const project = projects[0];
    if (!project) return outcome("missing", null);

    if (operation === "add") {
      const kind = String(form.get("kind") ?? "");
      const layer = readLayer(form, kind, project);
      if (!layer) return outcome("invalid");
      const added = await db.query(`
        INSERT INTO design_layers
          (organization_id, project_id, layer_order, kind, x, y, width, height, color, content, font_size)
        SELECT $1, $2, coalesce(max(layer_order), 0) + 1, $3, $4, $5, $6, $7, $8, $9, $10
        FROM design_layers WHERE organization_id = $1 AND project_id = $2
        HAVING count(*) < $11
      `, [...args, kind, layer.x, layer.y, layer.width, layer.height, layer.fill, layer.content, layer.fontSize, layerLimit]);
      if (!added.rowCount) return outcome("limit");
      await audit(db, scope, "layer_added", projectId);
      return outcome("saved");
    }

    const layerId = String(form.get("layerId") ?? "");
    const revision = whole(form, "revision", 1, 2147483647);
    if (!uuid.test(layerId) || revision === null) return outcome("invalid");
    const layerArgs = [...args, layerId];
    const { rows: layers } = await db.query<Pick<DesignLayer, "id" | "layer_order" | "kind" | "revision">>(`
      SELECT id, layer_order, kind, revision FROM design_layers
      WHERE organization_id = $1 AND project_id = $2 AND id = $3
    `, layerArgs);
    const original = layers[0];
    if (!original || original.revision !== revision) return outcome("stale");

    if (operation === "edit") {
      const layer = readLayer(form, original.kind, project);
      if (!layer) return outcome("invalid");
      await db.query(`
        UPDATE design_layers SET x = $4, y = $5, width = $6, height = $7, color = $8,
          content = $9, font_size = $10, revision = revision + 1
        WHERE organization_id = $1 AND project_id = $2 AND id = $3
      `, [...layerArgs, layer.x, layer.y, layer.width, layer.height, layer.fill, layer.content, layer.fontSize]);
    } else if (operation === "remove") {
      await db.query("DELETE FROM design_layers WHERE organization_id = $1 AND project_id = $2 AND id = $3", layerArgs);
    } else if (operation === "forward" || operation === "backward") {
      const before = operation === "backward";
      const { rows: neighbors } = await db.query<{ id: string; layer_order: number }>(`
        SELECT id, layer_order FROM design_layers WHERE organization_id = $1 AND project_id = $2
          AND layer_order ${before ? "<" : ">"} $3
        ORDER BY layer_order ${before ? "DESC" : "ASC"} LIMIT 1
      `, [...args, original.layer_order]);
      const neighbor = neighbors[0];
      if (!neighbor) return outcome("stale");
      await db.query("SET CONSTRAINTS design_layers_order DEFERRED");
      await db.query(`
        UPDATE design_layers SET layer_order = CASE id WHEN $3 THEN $5::int ELSE $6::int END, revision = revision + 1
        WHERE organization_id = $1 AND project_id = $2 AND id IN ($3, $4)
      `, [...layerArgs, neighbor.id, neighbor.layer_order, original.layer_order]);
    } else {
      return outcome("invalid");
    }
    await audit(db, scope, `layer_${operation}`, projectId);
    return outcome("saved");
  });
}
