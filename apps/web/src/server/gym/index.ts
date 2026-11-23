import "server-only";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";
import { auditGym, gymEntitlement, isGymId, lockGymWrite, today } from "./access";

type Member = { id: string; name: string; active: boolean; attended: boolean };

export async function readRoster(page: number) {
  const session = await requireMembership();
  const { rows } = await pool.query<{ allowed: boolean; members: Member[] }>(`
    WITH access AS (SELECT 1 ${gymEntitlement}), members AS (
      SELECT g.id, g.name, g.created_at,
        EXISTS (SELECT 1 FROM gym_memberships w
          WHERE w.organization_id = g.organization_id AND w.member_id = g.id
            AND ${today} BETWEEN w.starts_on AND w.ends_on) AS active,
        EXISTS (SELECT 1 FROM gym_attendance a
          WHERE a.organization_id = g.organization_id AND a.member_id = g.id
            AND a.attended_on = ${today}) AS attended
      FROM gym_members g
      WHERE g.organization_id = $1 AND EXISTS (SELECT 1 FROM access)
      ORDER BY g.created_at DESC, g.id DESC LIMIT 26 OFFSET $3
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed,
      COALESCE((SELECT json_agg(members ORDER BY created_at DESC, id DESC) FROM members), '[]') AS members
  `, [session.organizationId, session.userId, (page - 1) * 25]);

  return rows[0];
}

type GymAction =
  | { kind: "register"; name: string }
  | { kind: "attend"; memberId: string };

export async function updateRoster(organizationId: string, action: GymAction) {
  const session = await requireMembership(organizationId);
  const scope: [string, string] = [session.organizationId, session.userId];

  return transaction(async (db) => {
    if (!(await lockGymWrite(db, scope))) return "forbidden";

    let memberId: string;
    if (action.kind === "register") {
      const name = action.name.trim();
      if (!name || name.length > 120 || name.includes("\0")) return "invalid";
      const result = await db.query<{ id: string }>(
        "INSERT INTO gym_members (organization_id, name) VALUES ($1, $2) RETURNING id",
        [scope[0], name],
      );
      memberId = result.rows[0].id;
    } else {
      memberId = action.memberId;
      if (!isGymId(memberId)) return "invalid";
      const args = [scope[0], memberId];
      const member = await db.query(
        "SELECT id FROM gym_members WHERE organization_id = $1 AND id = $2 FOR UPDATE", args,
      );
      if (!member.rowCount) return "invalid";

      const { rowCount: active } = await db.query(`
        SELECT 1 FROM gym_memberships
        WHERE organization_id = $1 AND member_id = $2 AND ${today} BETWEEN starts_on AND ends_on
      `, args);

      if (!active) return "inactive";
      const attendance = await db.query(`
        INSERT INTO gym_attendance (organization_id, member_id, attended_on)
        VALUES ($1, $2, ${today}) ON CONFLICT DO NOTHING
      `, args);
      if (!attendance.rowCount) return "already-attended";
    }

    await auditGym(db, scope, `gym.${action.kind}`, "gym_member", memberId);
    return action.kind;
  });
}
