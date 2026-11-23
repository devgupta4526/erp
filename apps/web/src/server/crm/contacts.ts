import "server-only";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";
import { crmAccessPredicate } from "./access";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
};

export async function listContacts(page: number) {
  const session = await requireMembership();
  const { rows } = await pool.query<{ allowed: boolean; contacts: Contact[] }>(`
    WITH access AS (SELECT 1 ${crmAccessPredicate}), contacts AS (
      SELECT c.id, c.name, c.email, COALESCE(linked.name, c.company) AS company, c.created_at
      FROM crm_contacts c
      LEFT JOIN crm_companies linked ON linked.organization_id = c.organization_id AND linked.id = c.company_id
      WHERE c.organization_id = $1 AND EXISTS (SELECT 1 FROM access)
      ORDER BY c.created_at DESC, c.id DESC LIMIT 26 OFFSET $3
    )
    SELECT EXISTS(SELECT 1 FROM access) AS allowed,
      coalesce((SELECT json_agg(contacts ORDER BY created_at DESC, id DESC) FROM contacts), '[]') AS contacts
  `, [session.organizationId, session.userId, (page - 1) * 25]);

  return rows[0];
}

export async function createContact(organizationId: string, input: { name: string; email: string; company: string }) {
  const session = await requireMembership(organizationId);
  const name = input.name.trim();
  const email = input.email.trim();
  const company = input.company.trim();
  if (!name || name.length > 120 || company.length > 120 || email.length > 254 ||
      [name, email, company].some((value) => value.includes("\0")) ||
      (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return "invalid";

  return transaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(`
      WITH access AS (
        SELECT 1 ${crmAccessPredicate} AND m.role IN ('owner', 'admin') FOR SHARE OF s, p, m
      )
      INSERT INTO crm_contacts (organization_id, name, email, company)
      SELECT $1, $3, $4, $5 FROM access RETURNING id
    `, [session.organizationId, session.userId, name, email || null, company || null]);

    const contact = rows[0];
    if (!contact) return "forbidden";
    await client.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
      VALUES ($1, $2, 'crm.contact.created', 'crm_contact', $3)
    `, [session.organizationId, session.userId, contact.id]);
    return "created";
  });
}
