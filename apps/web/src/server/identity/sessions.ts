import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { PoolClient } from "pg";
import { pool } from "@/server/db";

export type OrganizationRole = "owner" | "admin" | "member";

export type IdentitySession = {
  userId: string;
  name: string;
  email: string;
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
};

const localHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.APP_ORIGIN ?? "");
const secureCookie = process.env.SECURE_COOKIES === "true" ||
  (process.env.NODE_ENV === "production" && !(localHttp && process.env.SECURE_COOKIES === "false"));
const cookieName = secureCookie ? "__Host-businessos_session" : "businessos_session";
const maxAge = 60 * 60 * 24 * 7;
const cookieOptions = { httpOnly: true, sameSite: "lax", secure: secureCookie, path: "/" } as const;

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function getSessionCookie(): Promise<string | undefined> {
  const value = (await cookies()).get(cookieName)?.value;
  return value && /^[a-zA-Z0-9_-]{43}$/.test(value) ? value : undefined;
}

export async function issueSession(
  client: PoolClient,
  session: IdentitySession,
  priorToken: string | undefined,
  action: "identity.registered" | "identity.signed_in",
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  if (priorToken) {
    await client.query("DELETE FROM identity_sessions WHERE token_hash = $1", [digest(priorToken)]);
  }
  await client.query(
    `INSERT INTO identity_sessions (token_hash, organization_id, user_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [digest(token), session.organizationId, session.userId, maxAge],
  );
  await client.query(
    `INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
     VALUES ($1, $2, $3, 'user', $2)`,
    [session.organizationId, session.userId, action],
  );
  return token;
}

export async function writeSessionCookie(token: string): Promise<void> {
  (await cookies()).set(cookieName, token, { ...cookieOptions, maxAge });
}

export async function getSession(): Promise<IdentitySession | null> {
  const token = await getSessionCookie();
  if (!token) {
    return null;
  }
  const result = await pool.query<IdentitySession>(
    `SELECT u.id AS "userId", u.name, u.email, o.id AS "organizationId",
            o.name AS "organizationName", m.role
       FROM identity_sessions s
       JOIN organization_memberships m USING (organization_id, user_id)
       JOIN users u ON u.id = s.user_id
       JOIN organizations o ON o.id = s.organization_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [digest(token)],
  );
  return result.rows[0] ?? null;
}

export async function logout(): Promise<void> {
  const token = await getSessionCookie();
  if (token) {
    await pool.query(
      `WITH revoked AS (
         DELETE FROM identity_sessions WHERE token_hash = $1
         RETURNING organization_id, user_id, expires_at
       )
       INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
       SELECT organization_id, user_id, 'identity.signed_out', 'user', user_id
         FROM revoked WHERE expires_at > now()`,
      [digest(token)],
    );
  }
  (await cookies()).set(cookieName, "", { ...cookieOptions, maxAge: 0 });
}
