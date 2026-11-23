import "server-only";
import type { PoolClient } from "pg";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";
import { crmAccessPredicate } from "./access";

export const stages = [
  ["qualified", "Qualified"],
  ["proposal", "Proposal"],
  ["negotiation", "Negotiation"],
  ["won", "Won"],
  ["lost", "Lost"],
] as const;

type Stage = typeof stages[number][0];
type NamedRow = { id: string; name: string };
type Opportunity = NamedRow & { stage: Stage };
type OpportunityDetails = Opportunity & { contact_name: string | null };
type Task = NamedRow & { due_on: string | null; completed: boolean };
type Lead = NamedRow & { email: string | null; opportunity_id: string | null };
type Listing<Row, Parent = null> = { allowed: boolean; parent: Parent | null; records: Row[] };

export const crmPageSize = 25;
export const isCrmId = (value: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

export async function listCompanies(page: number) {
  const session = await requireMembership();
  const result = await pool.query<Listing<NamedRow>>(`
    WITH access AS (SELECT 1 ${crmAccessPredicate}), entries AS (
      SELECT c.id, c.name FROM crm_companies c
      WHERE c.organization_id = $1 AND EXISTS (SELECT 1 FROM access)
      ORDER BY lower(c.name), c.id LIMIT 26 OFFSET $3
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed, NULL AS parent,
      COALESCE((SELECT json_agg(entries ORDER BY lower(name), id) FROM entries), '[]') AS records
  `, [session.organizationId, session.userId, (page - 1) * crmPageSize]);
  return result.rows[0];
}

export async function listOpportunities(companyId: string, page: number) {
  const session = await requireMembership();
  const result = await pool.query<Listing<Opportunity, NamedRow>>(`
    WITH access AS (SELECT 1 ${crmAccessPredicate}), company AS (
      SELECT c.id, c.name FROM crm_companies c
      WHERE c.organization_id = $1 AND c.id = $3 AND EXISTS (SELECT 1 FROM access)
    ), entries AS (
      SELECT o.id, o.name, o.stage, o.created_at FROM crm_opportunities o
      JOIN company ON company.id = o.company_id WHERE o.organization_id = $1
      ORDER BY o.created_at DESC, o.id DESC LIMIT 26 OFFSET $4
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed,
      (SELECT row_to_json(company) FROM company) AS parent,
      COALESCE((SELECT json_agg(entries ORDER BY created_at DESC, id DESC) FROM entries), '[]') AS records
  `, [session.organizationId, session.userId, companyId, (page - 1) * crmPageSize]);
  return result.rows[0];
}

export async function listTasks(companyId: string, opportunityId: string, page: number) {
  const session = await requireMembership();
  const result = await pool.query<Listing<Task, OpportunityDetails>>(`
    WITH access AS (SELECT 1 ${crmAccessPredicate}), opportunity AS (
      SELECT o.id, o.name, o.stage, contact.name AS contact_name FROM crm_opportunities o
      LEFT JOIN crm_contacts contact ON contact.organization_id = o.organization_id AND contact.id = o.contact_id
      WHERE o.organization_id = $1 AND o.company_id = $3 AND o.id = $4 AND EXISTS (SELECT 1 FROM access)
    ), entries AS (
      SELECT t.id, t.name, t.due_on::text, (t.completed_at IS NOT NULL) AS completed, t.created_at
      FROM crm_tasks t JOIN opportunity ON opportunity.id = t.opportunity_id
      WHERE t.organization_id = $1 AND t.company_id = $3
      ORDER BY t.created_at DESC, t.id DESC LIMIT 26 OFFSET $5
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed,
      (SELECT row_to_json(opportunity) FROM opportunity) AS parent,
      COALESCE((SELECT json_agg(entries ORDER BY created_at DESC, id DESC) FROM entries), '[]') AS records
  `, [session.organizationId, session.userId, companyId, opportunityId, (page - 1) * crmPageSize]);
  return result.rows[0];
}

export async function listLeads(companyId: string, page: number) {
  const session = await requireMembership();
  const result = await pool.query<Listing<Lead, NamedRow>>(`
    WITH access AS (SELECT 1 ${crmAccessPredicate}), company AS (
      SELECT c.id, c.name FROM crm_companies c
      WHERE c.organization_id = $1 AND c.id = $3 AND EXISTS (SELECT 1 FROM access)
    ), entries AS (
      SELECT l.id, l.name, l.email, l.created_at, o.id AS opportunity_id FROM crm_leads l
      JOIN company ON company.id = l.company_id
      LEFT JOIN crm_opportunities o ON o.organization_id = l.organization_id AND o.company_id = l.company_id AND o.lead_id = l.id
      WHERE l.organization_id = $1
      ORDER BY l.created_at DESC, l.id DESC LIMIT 26 OFFSET $4
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed,
      (SELECT row_to_json(company) FROM company) AS parent,
      COALESCE((SELECT json_agg(entries ORDER BY created_at DESC, id DESC) FROM entries), '[]') AS records
  `, [session.organizationId, session.userId, companyId, (page - 1) * crmPageSize]);
  return result.rows[0];
}

type Scope = { organizationId: string; userId: string };
type MutationResult = "saved" | "invalid" | "forbidden" | "missing" | "duplicate" | "unchanged";
type AuditEntry = {
  id: string;
  entity: "company" | "lead" | "opportunity" | "task";
  action: string;
  metadata?: Record<string, string>;
};

async function mutate(
  organizationId: string,
  write: (client: PoolClient, scope: Scope) => Promise<AuditEntry | MutationResult>,
): Promise<MutationResult> {
  const scope = await requireMembership(organizationId);
  return transaction(async (client) => {
    const { rowCount } = await client.query(`
      SELECT 1 ${crmAccessPredicate} AND m.role IN ('owner', 'admin') FOR SHARE OF s, p, m
    `, [scope.organizationId, scope.userId]);
    if (!rowCount) return "forbidden";
    const result = await write(client, scope);
    if (typeof result === "string") return result;
    await client.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `, [
      scope.organizationId, scope.userId, `crm.${result.entity}.${result.action}`,
      `crm_${result.entity}`, result.id,
      JSON.stringify(result.metadata ?? {}),
    ]);
    return "saved";
  });
}

function validName(input: string) {
  const name = input.trim();
  return name && name.length <= 120 && !/\p{C}/u.test(name) ? name : null;
}

function validDate(date: string) {
  return /^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date;
}

export async function createCompany(organizationId: string, input: string) {
  const name = validName(input);
  if (!name) return "invalid";
  return mutate(organizationId, async (client, scope) => {
    const { rows } = await client.query<{ id: string }>(`
      INSERT INTO crm_companies (organization_id, name) VALUES ($1, $2)
      ON CONFLICT (organization_id, (lower(name))) DO NOTHING RETURNING id
    `, [scope.organizationId, name]);
    return rows[0] ? { id: rows[0].id, entity: "company", action: "created" } : "duplicate";
  });
}

export async function createOpportunity(organizationId: string, companyId: string, input: string) {
  const name = validName(input);
  if (!name || !isCrmId(companyId)) return "invalid";
  return mutate(organizationId, async (client, scope) => {
    const { rows } = await client.query<{ id: string }>(`
      INSERT INTO crm_opportunities (organization_id, company_id, name)
      SELECT organization_id, id, $3 FROM crm_companies
      WHERE organization_id = $1 AND id = $2 RETURNING id
    `, [scope.organizationId, companyId, name]);
    return rows[0] ? { id: rows[0].id, entity: "opportunity", action: "created" } : "missing";
  });
}

export async function createLead(organizationId: string, companyId: string, input: string, rawEmail: string) {
  const name = validName(input);
  const email = rawEmail.trim();
  if (!name || !isCrmId(companyId) || email.length > 254 ||
      (email && !/^[^\s@\p{C}]+@[^\s@\p{C}]+\.[^\s@\p{C}]+$/u.test(email))) return "invalid";

  return mutate(organizationId, async (client, scope) => {
    const { rows } = await client.query<{ id: string }>(`
      INSERT INTO crm_leads (organization_id, company_id, name, email)
      SELECT organization_id, id, $3, $4 FROM crm_companies
      WHERE organization_id = $1 AND id = $2 RETURNING id
    `, [scope.organizationId, companyId, name, email || null]);
    return rows[0] ? { id: rows[0].id, entity: "lead", action: "created" } : "missing";
  });
}

export async function convertLead(organizationId: string, companyId: string, leadId: string, input: string) {
  const name = validName(input);
  if (!name || !isCrmId(companyId) || !isCrmId(leadId)) return "invalid";

  return mutate(organizationId, async (client, scope) => {
    const keys = [scope.organizationId, companyId, leadId];
    const { rows: leads } = await client.query<{ name: string; email: string | null }>(`
      SELECT name, email FROM crm_leads WHERE organization_id = $1 AND company_id = $2 AND id = $3 FOR UPDATE
    `, keys);
    if (!leads[0]) return "missing";

    const existing = await client.query(`
      SELECT 1 FROM crm_opportunities WHERE organization_id = $1 AND company_id = $2 AND lead_id = $3
    `, keys);
    if (existing.rowCount) return "unchanged";

    const lead = leads[0];
    const contact = await client.query<{ id: string }>(`
      INSERT INTO crm_contacts (organization_id, company_id, name, email)
      VALUES ($1, $2, $3, $4) RETURNING id
    `, [scope.organizationId, companyId, lead.name, lead.email]);
    const contactId = contact.rows[0].id;
    const opportunity = await client.query<{ id: string }>(`
      INSERT INTO crm_opportunities (organization_id, company_id, lead_id, name, contact_id)
      VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [...keys, name, contactId]);

    return {
      id: leadId,
      entity: "lead",
      action: "converted",
      metadata: { contactId, opportunityId: opportunity.rows[0].id },
    };
  });
}

export async function moveOpportunity(organizationId: string, companyId: string, opportunityId: string, from: string, to: string) {
  if (!isCrmId(companyId) || !isCrmId(opportunityId) ||
      !stages.some(([value]) => value === from) || !stages.some(([value]) => value === to)) return "invalid";
  return mutate(organizationId, async (client, scope) => {
    if (from === to) return "unchanged";
    const { rows } = await client.query<{ id: string }>(`
      UPDATE crm_opportunities SET stage = $5
      WHERE organization_id = $1 AND company_id = $2 AND id = $3 AND stage = $4 RETURNING id
    `, [scope.organizationId, companyId, opportunityId, from, to]);
    return rows[0] ? { id: rows[0].id, entity: "opportunity", action: "stage_changed", metadata: { from, to } } : "missing";
  });
}

export async function createTask(organizationId: string, companyId: string, opportunityId: string, input: string, dueOn: string) {
  const name = validName(input);
  if (!name || !isCrmId(companyId) || !isCrmId(opportunityId) || (dueOn && !validDate(dueOn))) return "invalid";
  return mutate(organizationId, async (client, scope) => {
    const { rows } = await client.query<{ id: string }>(`
      INSERT INTO crm_tasks (organization_id, company_id, opportunity_id, name, due_on)
      SELECT organization_id, company_id, id, $4, $5::date FROM crm_opportunities
      WHERE organization_id = $1 AND company_id = $2 AND id = $3 RETURNING id
    `, [scope.organizationId, companyId, opportunityId, name, dueOn || null]);
    return rows[0] ? { id: rows[0].id, entity: "task", action: "created" } : "missing";
  });
}

export async function completeTask(organizationId: string, companyId: string, opportunityId: string, taskId: string) {
  if (![companyId, opportunityId, taskId].every(isCrmId)) return "invalid";
  return mutate(organizationId, async (client, scope) => {
    const { rows } = await client.query<{ id: string }>(`
      UPDATE crm_tasks SET completed_at = now()
      WHERE organization_id = $1 AND company_id = $2 AND opportunity_id = $3
        AND id = $4 AND completed_at IS NULL RETURNING id
    `, [scope.organizationId, companyId, opportunityId, taskId]);
    return rows[0] ? { id: rows[0].id, entity: "task", action: "completed" } : "missing";
  });
}
