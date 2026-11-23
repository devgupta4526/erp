import "server-only";

import { pool, transaction } from "@/server/db";
import { initializeSubscription } from "@/server/subscriptions";
import { hashPassword, PasswordCapacityError, verifyPassword } from "./passwords";
import {
  digest,
  getSession,
  getSessionCookie,
  issueSession,
  writeSessionCookie,
  type IdentitySession,
  type OrganizationRole,
} from "./sessions";

export { getSession, logout } from "./sessions";
export type { IdentitySession, OrganizationRole } from "./sessions";

type IdentityErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CREDENTIALS"
  | "EMAIL_EXISTS"
  | "RATE_LIMITED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN";

export class IdentityError extends Error {
  constructor(public readonly code: IdentityErrorCode, message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

type Credentials = { email: string; password: string };
type Registration = Credentials & { name: string; organizationName: string };

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@\p{C}]+@[^\s@\p{C}]+\.[^\s@\p{C}]+$/u.test(email);
}

function validName(value: string): boolean {
  return value.length > 0 && value.length <= 120 && !/\p{C}/u.test(value);
}

function deniedCredentials(): IdentityError {
  return new IdentityError("INVALID_CREDENTIALS", "The email or password is incorrect.");
}

async function usePasswordService<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PasswordCapacityError) {
      throw new IdentityError("RATE_LIMITED", error.message);
    }
    throw error;
  }
}

export async function register(input: Registration): Promise<IdentitySession> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const organizationName = input.organizationName.trim();
  if (!validEmail(email) || !validName(name) || !validName(organizationName)) {
    throw new IdentityError("INVALID_INPUT", "Enter a valid name, email and organization name.");
  }
  if (Array.from(input.password).length < 15 || Buffer.byteLength(input.password) > 1024) {
    throw new IdentityError("INVALID_INPUT", "Use at least 15 characters and at most 1,024 bytes for your password.");
  }

  const passwordHash = await usePasswordService(() => hashPassword(input.password));
  const priorToken = await getSessionCookie();
  const { session, token } = await transaction(async (client) => {
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [name, email, passwordHash],
    );
    if (!user.rows[0]) {
      throw new IdentityError("EMAIL_EXISTS", "An account already exists for this email.");
    }
    const organization = await client.query<{ id: string }>(
      "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
      [organizationName],
    );
    const userId = user.rows[0].id;
    const organizationId = organization.rows[0].id;
    const session: IdentitySession = { userId, name, email, organizationId, organizationName, role: "owner" };
    await client.query(
      "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
      [organizationId, userId],
    );
    await initializeSubscription(client, organizationId);
    const token = await issueSession(client, session, priorToken, "identity.registered");
    return { session, token };
  });
  await writeSessionCookie(token);
  return session;
}

export async function login(input: Credentials): Promise<IdentitySession> {
  const email = input.email.trim().toLowerCase();
  if (!validEmail(email) || !input.password || Buffer.byteLength(input.password) > 1024) {
    throw deniedCredentials();
  }

  const emailHash = digest(email);
  const limit = await pool.query(
    `INSERT INTO identity_login_attempts AS bucket (email_hash, attempts, reset_at)
     VALUES ($1, 1, now() + interval '15 minutes')
     ON CONFLICT (email_hash) DO UPDATE SET
       attempts = CASE WHEN bucket.reset_at <= now() THEN 1 ELSE bucket.attempts + 1 END,
       reset_at = CASE WHEN bucket.reset_at <= now() THEN excluded.reset_at ELSE bucket.reset_at END
     WHERE bucket.reset_at <= now() OR bucket.attempts < 10
     RETURNING attempts`,
    [emailHash],
  );
  if (!limit.rowCount) {
    throw new IdentityError("RATE_LIMITED", "Too many sign-in attempts. Try again later.");
  }

  const result = await pool.query<{ id: string; passwordHash: string }>(
    'SELECT id, password_hash AS "passwordHash" FROM users WHERE email = $1',
    [email],
  );
  const user = result.rows[0];
  const valid = await usePasswordService(() => verifyPassword(input.password, user?.passwordHash));
  if (!user || !valid) {
    throw deniedCredentials();
  }

  const priorToken = await getSessionCookie();
  const { session, token } = await transaction(async (client) => {
    const membership = await client.query<IdentitySession>(
      `SELECT u.id AS "userId", u.name, u.email, o.id AS "organizationId",
              o.name AS "organizationName", m.role
         FROM organization_memberships m
         JOIN users u ON u.id = m.user_id
         JOIN organizations o ON o.id = m.organization_id
        WHERE u.id = $1 AND u.password_hash = $2
        ORDER BY m.created_at, m.organization_id
        LIMIT 1
        FOR KEY SHARE OF m`,
      [user.id, user.passwordHash],
    );
    const session = membership.rows[0];
    if (!session) {
      throw deniedCredentials();
    }
    const token = await issueSession(client, session, priorToken, "identity.signed_in");
    await client.query("DELETE FROM identity_login_attempts WHERE email_hash = $1", [emailHash]);
    return { session, token };
  });
  await writeSessionCookie(token);
  return session;
}

export async function requireMembership(
  organizationId?: string,
  roles?: readonly OrganizationRole[],
): Promise<IdentitySession> {
  const session = await getSession();
  if (!session) {
    throw new IdentityError("UNAUTHENTICATED", "Sign in to access this workspace.");
  }
  if ((organizationId !== undefined && organizationId !== session.organizationId) ||
      (roles !== undefined && !roles.includes(session.role))) {
    throw new IdentityError("FORBIDDEN", "You do not have permission to access this workspace.");
  }
  return session;
}
