import "server-only";
import { transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";
import { practiceEntitlement } from "./index";

const fileLimit = 512 * 1024;
const organizationLimit = 20 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function detectType(name: string, bytes: Buffer) {
  if (/\.pdf$/i.test(name) && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (!/\.txt$/i.test(name) || bytes.includes(0)) return undefined;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "text/plain";
  } catch {
    return undefined;
  }
}

export async function addPracticeDocument(organizationId: string, engagementId: string, file: FormDataEntryValue | null) {
  const session = await requireMembership(organizationId);
  if (!uuid.test(engagementId) || !(file instanceof File) || file.size < 1 || file.size > fileLimit) return "file-invalid";
  const name = file.name.trim();
  if (!name || name.length > 120 || /[\\/\p{C}]/u.test(name)) return "file-invalid";
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = detectType(name, bytes);
  if (!type) return "file-invalid";

  return transaction(async (db) => {
    const access = await db.query<{ can_manage: boolean }>(`
      SELECT m.role IN ('owner', 'admin') AS can_manage
      ${practiceEntitlement} FOR UPDATE OF s FOR SHARE OF p, m
    `, [organizationId, session.userId]);
    if (!access.rows[0]) return "forbidden";
    const engagement = await db.query<{ status: string }>(`
      SELECT status FROM practice_engagements WHERE organization_id = $1 AND id = $2
        AND ($3::boolean OR assignee_user_id = $4)
      FOR UPDATE
    `, [organizationId, engagementId, access.rows[0].can_manage, session.userId]);
    if (!engagement.rows[0]) return "forbidden";
    if (engagement.rows[0].status !== "open") return "state";
    const budget = await db.query<{ bytes: string; documents: number }>(`
      SELECT coalesce(sum(octet_length(content)), 0)::text AS bytes,
        count(*) FILTER (WHERE engagement_id = $2)::int AS documents
      FROM practice_documents WHERE organization_id = $1
    `, [organizationId, engagementId]);
    if (Number(budget.rows[0].bytes) + bytes.length > organizationLimit || budget.rows[0].documents >= 25) return "storage-limit";
    const stored = await db.query<{ id: string }>(`
      INSERT INTO practice_documents (organization_id, engagement_id, name, media_type, content)
      VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [organizationId, engagementId, name, type, bytes]);
    await db.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
      VALUES ($1, $2, 'practice.document.uploaded', 'practice_document', $3)
    `, [organizationId, session.userId, stored.rows[0].id]);
    return "uploaded";
  });
}

export async function fetchPracticeDocument(organizationId: string, engagementId: string, documentId: string) {
  const session = await requireMembership(organizationId);
  if (!uuid.test(engagementId) || !uuid.test(documentId)) return undefined;
  return transaction(async (db) => {
    const result = await db.query<{ name: string; media_type: string; content: Buffer }>(`
      WITH access AS (SELECT m.role IN ('owner', 'admin') AS can_manage ${practiceEntitlement})
      SELECT d.name, d.media_type, d.content
      FROM practice_documents d
      JOIN practice_engagements e ON e.organization_id = d.organization_id AND e.id = d.engagement_id
      CROSS JOIN access
      WHERE d.organization_id = $1 AND d.engagement_id = $3 AND d.id = $4
        AND (access.can_manage OR e.assignee_user_id = $2)
    `, [organizationId, session.userId, engagementId, documentId]);
    if (!result.rows[0]) return undefined;
    await db.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
      VALUES ($1, $2, 'practice.document.download_authorized', 'practice_document', $3)
    `, [organizationId, session.userId, documentId]);
    return result.rows[0];
  });
}
