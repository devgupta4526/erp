import "server-only";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, transaction } from "@/server/db";
import { getSession, requireMembership, type IdentitySession } from "@/server/identity";
import { digest, getSessionCookie } from "@/server/identity/sessions";

const roles = ["owner", "admin"] as const;

async function lockSubscription(db: PoolClient, organizationId: string) {
  const { rows } = await db.query<{ seat_limit: number | null; branch_limit: number | null; active: boolean }>(`
    SELECT p.seat_limit, p.branch_limit,
      (s.status IN ('trialing', 'active') AND s.access_until > clock_timestamp()) AS active
    FROM organization_subscriptions s
    JOIN subscription_plans p ON p.code = s.plan_code
    WHERE s.organization_id = $1
    FOR UPDATE OF s
  `, [organizationId]);
  return rows[0];
}

async function lockAdmin(db: PoolClient, session: IdentitySession) {
  const result = await db.query(`
    SELECT 1 FROM organization_memberships
    WHERE organization_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')
    FOR SHARE
  `, [session.organizationId, session.userId]);
  return Boolean(result.rowCount);
}

async function audit(db: PoolClient, organizationId: string, userId: string, action: string, entityType: string, entityId: string | null) {
  await db.query(`
    INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
    VALUES ($1, $2, $3, $4, $5)
  `, [organizationId, userId, action, entityType, entityId]);
}

export async function readOrganizations() {
  const session = await requireMembership();
  const { rows } = await pool.query<{ id: string; name: string; role: string }>(`
    SELECT o.id, o.name, m.role
    FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = $1 ORDER BY lower(o.name), o.id
  `, [session.userId]);
  return rows;
}

export async function switchOrganization(expectedOrganizationId: string, organizationId: string) {
  const session = await getSession();
  const token = await getSessionCookie();
  if (!session || session.organizationId !== expectedOrganizationId || !token ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(organizationId)) return false;
  const { rowCount } = await pool.query(`
    UPDATE identity_sessions s SET organization_id = m.organization_id
    FROM organization_memberships m
    WHERE s.token_hash = $1 AND s.user_id = $2 AND s.expires_at > now()
      AND m.user_id = s.user_id AND m.organization_id = $3 AND s.organization_id = $4
  `, [digest(token), session.userId, organizationId, expectedOrganizationId]);
  return Boolean(rowCount);
}

export async function readAdministration(organizationId: string) {
  const session = await requireMembership(organizationId, roles);
  const [branches, members, events, invitations] = await Promise.all([
    pool.query<{ id: string; name: string }>(`
      SELECT id, name FROM organization_branches WHERE organization_id = $1 ORDER BY lower(name), id LIMIT 100
    `, [session.organizationId]),
    pool.query<{ id: string; name: string; email: string; role: string }>(`
      SELECT u.id, u.name, u.email, m.role FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1 ORDER BY lower(u.name), u.id LIMIT 100
    `, [session.organizationId]),
    pool.query<{ id: string; action: string; created_at: Date }>(`
      SELECT id, action, created_at FROM audit_events WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20
    `, [session.organizationId]),
    pool.query<{ email: string; expires_at: Date }>(`
      SELECT email, expires_at FROM organization_invitations WHERE organization_id = $1 AND expires_at > now()
      ORDER BY expires_at DESC, email LIMIT 100
    `, [session.organizationId]),
  ]);
  return { branches: branches.rows, members: members.rows, events: events.rows, invitations: invitations.rows };
}

export async function createBranch(organizationId: string, rawName: string) {
  const session = await requireMembership(organizationId, roles);
  const name = rawName.trim();
  if (!name || name.length > 120 || /\p{C}/u.test(name)) return "invalid";
  return transaction(async (db) => {
    const plan = await lockSubscription(db, session.organizationId);
    if (!plan?.active || !(await lockAdmin(db, session))) return "forbidden";
    const count = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM organization_branches WHERE organization_id = $1", [session.organizationId],
    );
    if (plan.branch_limit !== null && count.rows[0].count >= plan.branch_limit) return "limit";
    const { rows } = await db.query<{ id: string }>(`
      INSERT INTO organization_branches (organization_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id
    `, [session.organizationId, name]);
    if (!rows[0]) return "duplicate";
    await audit(db, session.organizationId, session.userId, "organization.branch.created", "branch", rows[0].id);
    return "branch";
  });
}

export async function inviteMember(organizationId: string, rawEmail: string) {
  const session = await requireMembership(organizationId, roles);
  const email = rawEmail.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@\p{C}]+@[^\s@\p{C}]+\.[^\s@\p{C}]+$/u.test(email)) return { status: "invalid" };
  return transaction(async (db) => {
    const plan = await lockSubscription(db, session.organizationId);
    if (!plan?.active || !(await lockAdmin(db, session))) return { status: "forbidden" };
    const token = randomBytes(24).toString("base64url");
    await db.query(`
      INSERT INTO organization_invitations (organization_id, token_hash, email, expires_at)
      VALUES ($1, $2, $3, now() + interval '3 days')
      ON CONFLICT (organization_id, email) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at
    `, [session.organizationId, digest(token), email]);
    await audit(db, session.organizationId, session.userId, "organization.invitation.created", "organization", session.organizationId);
    return { status: "invited", token };
  });
}

export async function acceptInvitation(activeOrganizationId: string, rawToken: string) {
  const session = await requireMembership(activeOrganizationId);
  const token = rawToken.trim();
  if (!/^[a-z0-9_-]{32}$/i.test(token)) return "invalid";
  return transaction(async (db) => {
    const hash = digest(token);
    const args = [hash, session.email];
    const invitation = await db.query<{ organization_id: string }>(`
      SELECT organization_id FROM organization_invitations
      WHERE token_hash = $1 AND email = $2 AND expires_at > now()
    `, args);
    const organizationId = invitation.rows[0]?.organization_id;
    if (!organizationId) return "invalid";
    const plan = await lockSubscription(db, organizationId);
    if (!plan?.active) return "forbidden";
    const valid = await db.query(`
      SELECT 1 FROM organization_invitations WHERE token_hash = $1 AND email = $2 AND expires_at > clock_timestamp() FOR UPDATE
    `, args);
    if (!valid.rowCount) return "invalid";
    const membership = await db.query(`
      SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2
    `, [organizationId, session.userId]);
    if (!membership.rowCount) {
      const count = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM organization_memberships WHERE organization_id = $1", [organizationId],
      );
      if (plan.seat_limit !== null && count.rows[0].count >= plan.seat_limit) return "limit";
      await db.query(`
        INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'member')
      `, [organizationId, session.userId]);
      await audit(db, organizationId, session.userId, "organization.invitation.accepted", "user", session.userId);
    }
    await db.query("DELETE FROM organization_invitations WHERE token_hash = $1", [hash]);
    return "joined";
  });
}

export async function revokeInvitation(organizationId: string, email: string) {
  const session = await requireMembership(organizationId, roles);
  return transaction(async (db) => {
    if (!(await lockAdmin(db, session))) return "forbidden";
    const revoked = await db.query(
      "DELETE FROM organization_invitations WHERE organization_id = $1 AND email = $2",
      [organizationId, email],
    );
    if (!revoked.rowCount) return "invalid";
    await audit(db, organizationId, session.userId, "organization.invitation.revoked", "organization", organizationId);
    return "revoked";
  });
}

export async function changeMemberRole(organizationId: string, userId: string, role: string) {
  const session = await requireMembership(organizationId, ["owner"]);
  if ((role !== "admin" && role !== "member") ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(userId)) return "invalid";
  return transaction(async (db) => {
    const owner = await db.query(
      "SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND role = 'owner' FOR SHARE",
      [organizationId, session.userId],
    );
    if (!owner.rowCount) return "forbidden";
    const changed = await db.query(`
      UPDATE organization_memberships SET role = $3
      WHERE organization_id = $1 AND user_id = $2 AND role <> 'owner'
    `, [organizationId, userId, role]);
    if (!changed.rowCount) return "invalid";
    await audit(db, organizationId, session.userId, `organization.member.role.${role}`, "user", userId);
    return "role";
  });
}
