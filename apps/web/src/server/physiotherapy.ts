import "server-only";

import type { PoolClient } from "pg";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";
import { invoiceCurrencies } from "@/server/invoices";

const clinicalRoles = ["owner", "admin"] as const;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const entitlement = `FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'physiotherapy'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND m.role IN ('owner', 'admin')
    AND s.status IN ('active', 'trialing') AND s.access_until > now()`;

type Patient = { id: string; name: string; contact: string; is_demo: boolean };
type Plan = { id: string; title: string; goals: string; home_program: string; status: string };
type Visit = { id: string; title: string; clinician: string; starts_at: string; ends_at: string; location: string;
  status: string; currency: string; fee_minor: number; progress: string | null; patient_rating: number | null;
  invoice_id: string | null; invoice_status: string | null };

export async function readPhysiotherapy(organizationId: string, patientId?: string, search = "", page = 1) {
  const session = await requireMembership(organizationId, clinicalRoles);
  const id = patientId && uuid.test(patientId) ? patientId : null;
  const { rows } = await pool.query<{ allowed: boolean; patients: Patient[]; patient: Patient | null;
    plans: Plan[]; visits: Visit[]; clinicians: { id: string; name: string }[] }>(`
    WITH permitted AS (SELECT 1 ${entitlement}), patient AS (
      SELECT id, name, contact, is_demo FROM physio_patients
      WHERE organization_id = $1 AND id = $3 AND EXISTS (SELECT 1 FROM permitted)
    ), directory AS (
      SELECT id, name, contact, is_demo FROM physio_patients
      WHERE organization_id = $1 AND $3 IS NULL AND position(lower($4) IN lower(name)) > 0 AND EXISTS (SELECT 1 FROM permitted)
      ORDER BY lower(name), id LIMIT 26 OFFSET $5
    ), plans AS (
      SELECT id, title, goals, home_program, status FROM physio_plans
      WHERE organization_id = $1 AND patient_id = (SELECT id FROM patient) ORDER BY created_at DESC, id DESC
    ), visits AS (
      SELECT v.id, p.title, u.name AS clinician, v.starts_at, v.ends_at, v.location, v.status, v.currency,
        v.fee_minor, v.progress, v.patient_rating, v.invoice_id,
        CASE WHEN i.id IS NULL THEN NULL WHEN i.issued_at IS NULL THEN 'draft'
          WHEN (SELECT coalesce(sum(r.amount_minor), 0) FROM sales_invoice_receipts r
            WHERE r.organization_id = i.organization_id AND r.invoice_id = i.id) >= (
              SELECT coalesce(sum(l.quantity::bigint * l.unit_minor), 0) FROM sales_invoice_lines l
              WHERE l.organization_id = i.organization_id AND l.invoice_id = i.id) THEN 'paid'
          ELSE 'issued' END AS invoice_status
      FROM physio_visits v JOIN physio_plans p ON (p.organization_id, p.patient_id, p.id) = (v.organization_id, v.patient_id, v.plan_id)
      JOIN users u ON u.id = v.clinician_id
      LEFT JOIN sales_invoices i ON (i.organization_id, i.id) = (v.organization_id, v.invoice_id)
      WHERE v.organization_id = $1 AND v.patient_id = (SELECT id FROM patient) ORDER BY v.starts_at DESC, v.id DESC
    ), clinicians AS (
      SELECT u.id, u.name FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1 AND m.role IN ('owner', 'admin') AND EXISTS (SELECT 1 FROM patient)
    )
    SELECT EXISTS (SELECT 1 FROM permitted) AS allowed,
      (SELECT row_to_json(patient) FROM patient) AS patient,
      coalesce((SELECT json_agg(directory ORDER BY lower(name), id) FROM directory), '[]') AS patients,
      coalesce((SELECT json_agg(plans) FROM plans), '[]') AS plans,
      coalesce((SELECT json_agg(visits ORDER BY starts_at DESC, id DESC) FROM visits), '[]') AS visits,
      coalesce((SELECT json_agg(clinicians ORDER BY lower(name), id) FROM clinicians), '[]') AS clinicians
  `, [organizationId, session.userId, id, search.trim().slice(0, 120), (page - 1) * 25]);
  return rows[0];
}

function textField(form: FormData, name: string, limit: number) {
  const value = String(form.get(name) ?? "").trim();
  return value.length <= limit && !/\p{C}/u.test(value.replaceAll(/\r?\n/g, "")) ? value : null;
}

function dateField(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 16) === value ? date : null;
}

async function audit(db: PoolClient, scope: string[], action: string, id: string) {
  await db.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
    VALUES ($1, $2, $3, 'physiotherapy', $4)`, [...scope, `physiotherapy.${action}`, id]);
}

async function draftInvoice(db: PoolClient, organizationId: string, patientId: string, visitId: string, currency: string, fee: number) {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO sales_invoices (organization_id, customer_name, currency) VALUES ($1, $2, $3) RETURNING id",
    [organizationId, `Patient ${patientId}`, currency],
  );
  const id = rows[0].id;
  await db.query(`INSERT INTO sales_invoice_lines (organization_id, invoice_id, description, quantity, unit_minor)
    VALUES ($1, $2, 'Physiotherapy session', 1, $3)`, [organizationId, id, fee]);
  await db.query("UPDATE physio_visits SET invoice_id = $4 WHERE organization_id = $1 AND patient_id = $2 AND id = $3",
    [organizationId, patientId, visitId, id]);
  return id;
}

async function seedDemo(db: PoolClient, scope: string[]) {
  const [organizationId, clinician] = scope;
  const created = await db.query<{ id: string }>(`INSERT INTO physio_patients (organization_id, name, contact, is_demo)
    VALUES ($1, 'Asha Demo', 'asha.physio@example.test', true)
    ON CONFLICT (organization_id) WHERE is_demo DO NOTHING RETURNING id`, [organizationId]);
  const patientId = created.rows[0]?.id;
  if (!patientId) {
    const existing = await db.query<{ id: string }>("SELECT id FROM physio_patients WHERE organization_id = $1 AND is_demo", [organizationId]);
    return existing.rows[0].id;
  }
  const plan = await db.query<{ id: string }>(`INSERT INTO physio_plans (organization_id, patient_id, title, goals, home_program)
    VALUES ($1, $2, 'Demo rehabilitation plan', 'Track fictional functional milestones across follow-up visits.',
      'Sample home-program field. Add a clinician-approved program when using this workflow in practice.') RETURNING id`, [organizationId, patientId]);
  const args = [organizationId, patientId, plan.rows[0].id, clinician];
  const visit = await db.query<{ id: string }>(`INSERT INTO physio_visits
    (organization_id, patient_id, plan_id, clinician_id, starts_at, ends_at, location, status, currency, fee_minor, progress, patient_rating)
    SELECT $1, $2, $3, $4, slot, slot + interval '30 minutes', 'clinic', 'completed', 'INR', 90000,
      'Fictional baseline assessment recorded. Follow-up visit arranged.', 4
    FROM generate_series(date_trunc('hour', now()) - interval '1 day', now() - interval '30 minutes', interval '1 hour') slot
    WHERE NOT EXISTS (SELECT 1 FROM physio_visits WHERE organization_id = $1 AND clinician_id = $4 AND status <> 'cancelled'
      AND tstzrange(starts_at, ends_at, '[)') && tstzrange(slot, slot + interval '30 minutes', '[)'))
    LIMIT 1 RETURNING id`, args);
  if (visit.rows[0]) await draftInvoice(db, organizationId, patientId, visit.rows[0].id, "INR", 90000);
  await db.query(`INSERT INTO physio_visits (organization_id, patient_id, plan_id, clinician_id, starts_at, ends_at, location, currency, fee_minor)
    SELECT $1, $2, $3, $4, slot, slot + interval '30 minutes', 'home', 'INR', 120000
    FROM generate_series(date_trunc('hour', now()) + interval '1 day', now() + interval '7 days', interval '4 hours') slot
    WHERE NOT EXISTS (SELECT 1 FROM physio_visits WHERE organization_id = $1 AND clinician_id = $4 AND status <> 'cancelled'
      AND tstzrange(starts_at, ends_at, '[)') && tstzrange(slot, slot + interval '30 minutes', '[)')) LIMIT 1`, args);
  await audit(db, scope, "demo.loaded", patientId);
  return patientId;
}

export async function updatePhysiotherapy(organizationId: string, patientId: string | null, form: FormData) {
  const session = await requireMembership(organizationId, clinicalRoles);
  const scope = [organizationId, session.userId];
  const operation = form.get("operation");
  const fail = (status: string) => ({ status, patientId });
  try {
    return await transaction(async db => {
      const allowed = await db.query(`SELECT 1 ${entitlement} FOR SHARE OF s, p, m`, scope);
      if (!allowed.rowCount) return fail("forbidden");
      if (operation === "demo" && !patientId) {
        const billing = await db.query(`SELECT 1 FROM organization_subscriptions s JOIN plan_modules p ON p.plan_code = s.plan_code
          WHERE s.organization_id = $1 AND p.module_code = 'invoices' FOR SHARE OF p`, [organizationId]);
        if (!billing.rowCount) return fail("forbidden");
        return { status: "demo", patientId: await seedDemo(db, scope) };
      }
      if (operation === "patient-create" || operation === "patient-edit") {
        const name = textField(form, "name", 120);
        const contact = textField(form, "contact", 254);
        if (!name || contact === null || /[\r\n]/.test(name + contact)) return fail("invalid");
        if (operation === "patient-create" && !patientId) {
          const { rows } = await db.query<{ id: string }>(`INSERT INTO physio_patients (organization_id, name, contact)
            VALUES ($1, $2, $3) RETURNING id`, [organizationId, name, contact]);
          await audit(db, scope, operation, rows[0].id);
          return { status: "saved", patientId: rows[0].id };
        }
        if (operation !== "patient-edit" || !patientId || !uuid.test(patientId)) return fail("invalid");
        const changed = await db.query("UPDATE physio_patients SET name = $3, contact = $4 WHERE organization_id = $1 AND id = $2",
          [organizationId, patientId, name, contact]);
        if (!changed.rowCount) return fail("unavailable");
        await audit(db, scope, operation, patientId);
        return fail("saved");
      }

      if (!patientId || !uuid.test(patientId)) return fail("invalid");
      const patient = await db.query<{ is_demo: boolean }>("SELECT is_demo FROM physio_patients WHERE organization_id = $1 AND id = $2 FOR UPDATE",
        [organizationId, patientId]);
      if (!patient.rowCount) return fail("unavailable");
      const target = [organizationId, patientId];
      const id = String(form.get("id") ?? "");
      let subjectId = id;
      switch (operation) {
        case "plan-create": {
          const title = textField(form, "title", 120);
          const goals = textField(form, "goals", 4000);
          const program = textField(form, "program", 4000);
          if (!title || !goals || program === null) return fail("invalid");
          const { rows } = await db.query<{ id: string }>(`INSERT INTO physio_plans (organization_id, patient_id, title, goals, home_program)
            VALUES ($1, $2, $3, $4, $5) RETURNING id`, [...target, title, goals, program]);
          subjectId = rows[0].id;
          break;
        }
        case "plan-complete": {
          if (!uuid.test(id)) return fail("invalid");
          const changed = await db.query(`UPDATE physio_plans p SET status = 'completed'
            WHERE (p.organization_id, p.patient_id, p.id) = ($1, $2, $3) AND p.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM physio_visits v WHERE (v.organization_id, v.patient_id, v.plan_id) = ($1, $2, $3) AND v.status = 'scheduled')`,
          [...target, id]);
          if (!changed.rowCount) return fail("plan-open");
          break;
        }
        case "visit-book": {
          const plan = String(form.get("plan") ?? "");
          const clinician = String(form.get("clinician") ?? "");
          const start = dateField(String(form.get("start") ?? ""));
          const end = dateField(String(form.get("end") ?? ""));
          const location = String(form.get("location") ?? "");
          const currency = form.get("currency");
          const amount = String(form.get("fee") ?? "").trim();
          const [units, fraction = ""] = amount.split(".");
          const fee = /^\d{1,7}(?:\.\d{1,2})?$/.test(amount) ? Number(units) * 100 + Number(fraction.padEnd(2, "0")) : 0;
          if (!uuid.test(plan) || !uuid.test(clinician) || !start || !end || end <= start || +end - +start > 28_800_000 ||
              !["clinic", "home"].includes(location) || !invoiceCurrencies.some(option => option === currency) || fee < 1 || fee > 100000000) return fail("invalid");
          const { rows } = await db.query<{ id: string }>(`INSERT INTO physio_visits
            (organization_id, patient_id, plan_id, clinician_id, starts_at, ends_at, location, currency, fee_minor)
            SELECT p.organization_id, p.patient_id, p.id, m.user_id, $5, $6, $7, $8, $9
            FROM physio_plans p JOIN organization_memberships m ON m.organization_id = p.organization_id
            WHERE (p.organization_id, p.patient_id, p.id) = ($1, $2, $3) AND p.status = 'active'
              AND m.user_id = $4 AND m.role IN ('owner', 'admin') RETURNING id`, [...target, plan, clinician, start, end, location, currency, fee]);
          if (!rows[0]) return fail("unavailable");
          subjectId = rows[0].id;
          break;
        }
        case "visit-complete":
        case "visit-cancel": {
          if (!uuid.test(id)) return fail("invalid");
          const complete = operation === "visit-complete";
          const progress = complete ? textField(form, "progress", 4000) : null;
          const rating = complete ? String(form.get("rating") ?? "") : "";
          if (complete && (!progress || (rating && !/^(?:[0-9]|10)$/.test(rating)))) return fail("invalid");
          const changed = await db.query(`UPDATE physio_visits SET status = $4, progress = $5, patient_rating = $6
            WHERE (organization_id, patient_id, id) = ($1, $2, $3) AND status = 'scheduled'
              AND ($4 = 'cancelled' OR starts_at <= now() OR $7)`,
          [...target, id, complete ? "completed" : "cancelled", progress, rating === "" ? null : Number(rating), patient.rows[0].is_demo]);
          if (!changed.rowCount) return fail("unavailable");
          break;
        }
        case "invoice-draft": {
          if (!uuid.test(id)) return fail("invalid");
          const visit = await db.query<{ currency: string; fee_minor: number; invoice_id: string | null }>(`
            SELECT v.currency, v.fee_minor, v.invoice_id FROM physio_visits v
            JOIN organization_subscriptions s ON s.organization_id = v.organization_id
            JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'invoices'
            WHERE (v.organization_id, v.patient_id, v.id) = ($1, $2, $3) AND v.status = 'completed' FOR UPDATE OF v FOR SHARE OF p`, [...target, id]);
          if (!visit.rows[0]) return fail("unavailable");
          if (!visit.rows[0].invoice_id) subjectId = await draftInvoice(db, organizationId, patientId, id, visit.rows[0].currency, visit.rows[0].fee_minor);
          break;
        }
        default: return fail("invalid");
      }
      await audit(db, scope, operation, subjectId);
      return fail("saved");
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23P01") return fail("overlap");
    throw error;
  }
}
