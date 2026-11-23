import "server-only";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

const entitlement = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'invoices'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const invoiceCurrencies = ["INR", "USD", "GBP", "EUR"] as const;

type Invoice = { id: string; number: string | null; customer_name: string; currency: string; total: string; paid: string };
type Line = { id: string; description: string; quantity: number; unit_minor: number };
type Receipt = { reference: string; amount_minor: string; received_at: string };

const amountColumns = `
  coalesce((SELECT sum(l.quantity::bigint * l.unit_minor) FROM sales_invoice_lines l
    WHERE l.organization_id = i.organization_id AND l.invoice_id = i.id), 0)::text AS total,
  coalesce((SELECT sum(r.amount_minor) FROM sales_invoice_receipts r
    WHERE r.organization_id = i.organization_id AND r.invoice_id = i.id), 0)::text AS paid
`;

export async function listInvoices(organizationId: string, page: number) {
  const session = await requireMembership(organizationId);
  const { rows } = await pool.query<{ allowed: boolean; invoices: Invoice[] }>(`
    WITH enabled AS (SELECT 1 ${entitlement}), items AS (
      SELECT i.id, i.number::text, i.customer_name, i.currency, i.created_at, ${amountColumns}
      FROM sales_invoices i WHERE organization_id = $1 AND exists (SELECT 1 FROM enabled)
      ORDER BY i.created_at DESC, i.id DESC LIMIT 26 OFFSET $3
    ) SELECT exists (SELECT 1 FROM enabled) AS allowed,
      coalesce((SELECT json_agg(items ORDER BY created_at DESC, id DESC) FROM items), '[]') AS invoices
  `, [organizationId, session.userId, (page - 1) * 25]);
  return rows[0];
}

export async function readInvoice(organizationId: string, invoiceId: string) {
  const session = await requireMembership(organizationId);
  if (!uuid.test(invoiceId)) return undefined;
  const { rows } = await pool.query<Invoice & { issued_at: Date | null; lines: Line[]; receipts: Receipt[] }>(`
    SELECT i.id, i.number::text, i.customer_name, i.currency, i.issued_at, ${amountColumns},
      coalesce((SELECT json_agg(l ORDER BY l.id) FROM sales_invoice_lines l
        WHERE l.organization_id = i.organization_id AND l.invoice_id = i.id), '[]') AS lines,
      coalesce((SELECT json_agg(r ORDER BY r.received_at, r.reference) FROM (
        SELECT reference, amount_minor::text, received_at FROM sales_invoice_receipts
        WHERE organization_id = i.organization_id AND invoice_id = i.id
      ) r), '[]') AS receipts
    FROM sales_invoices i WHERE i.organization_id = $1 AND i.id = $3 AND exists (SELECT 1 ${entitlement})
  `, [organizationId, session.userId, invoiceId]);
  return rows[0];
}

function minorUnits(value: string) {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) return 0n;
  const [units, fraction = ""] = value.split(".");
  return BigInt(units) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function field(form: FormData, key: string, max: number) {
  const value = String(form.get(key) ?? "").trim();
  return value.length <= max && !/\p{C}/u.test(value) ? value : "";
}

export async function updateInvoice(organizationId: string, invoiceId: string | null, form: FormData) {
  const session = await requireMembership(organizationId, ["owner", "admin"]);
  const operation = form.get("operation");
  const failure = (status: string) => ({ status, invoiceId });
  return transaction(async (db) => {
    const access = await db.query(`SELECT 1 ${entitlement} AND m.role IN ('owner', 'admin') FOR SHARE OF s, p, m`,
      [organizationId, session.userId]);
    if (!access.rowCount) return failure("forbidden");
    let id: string;
    if (operation === "create" && !invoiceId) {
      const name = field(form, "customerName", 120);
      const currency = field(form, "currency", 3);
      if (!name || !invoiceCurrencies.some((option) => option === currency)) return failure("invalid");
      const inserted = await db.query<{ id: string }>(`
        INSERT INTO sales_invoices (organization_id, customer_name, currency) VALUES ($1, $2, $3) RETURNING id
      `, [organizationId, name, currency]);
      id = inserted.rows[0].id;
    } else {
      if (!invoiceId || !uuid.test(invoiceId)) return failure("invalid");
      id = invoiceId;
      const args = [organizationId, id];
      const locked = await db.query<{ issued_at: Date | null }>(
        "SELECT issued_at FROM sales_invoices WHERE organization_id = $1 AND id = $2 FOR UPDATE", args,
      );
      if (!locked.rows[0]) return failure("invalid");
      const issued = Boolean(locked.rows[0].issued_at);
      if (operation === "line") {
        if (issued) return failure("locked");
        const description = field(form, "description", 160);
        const quantity = Number(form.get("quantity"));
        const price = minorUnits(field(form, "price", 15));
        if (!description || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000 ||
            price < 1n || price > 100000000n) return failure("invalid");
        const inserted = await db.query(`
          INSERT INTO sales_invoice_lines (organization_id, invoice_id, description, quantity, unit_minor)
          SELECT $1, $2, $3, $4, $5 WHERE (
            SELECT count(*) FROM sales_invoice_lines WHERE organization_id = $1 AND invoice_id = $2
          ) < 100
        `, [...args, description, quantity, price.toString()]);
        if (!inserted.rowCount) return failure("limit");
      } else if (operation === "remove") {
        if (issued) return failure("locked");
        const lineId = field(form, "lineId", 36);
        if (!uuid.test(lineId)) return failure("invalid");
        const removed = await db.query(
          "DELETE FROM sales_invoice_lines WHERE organization_id = $1 AND invoice_id = $2 AND id = $3",
          [...args, lineId],
        );
        if (!removed.rowCount) return failure("invalid");
      } else if (operation === "issue") {
        if (issued) return failure("locked");
        const lines = await db.query(
          "SELECT 1 FROM sales_invoice_lines WHERE organization_id = $1 AND invoice_id = $2 LIMIT 1", args,
        );
        if (!lines.rowCount) return failure("empty");
        await db.query(`
          WITH next AS (
            INSERT INTO invoice_counters (organization_id, last_number) VALUES ($1, 1)
            ON CONFLICT (organization_id) DO UPDATE SET last_number = invoice_counters.last_number + 1
            RETURNING last_number
          )
          UPDATE sales_invoices SET number = (SELECT last_number FROM next), issued_at = now()
          WHERE organization_id = $1 AND id = $2
        `, args);
      } else if (operation === "receipt") {
        if (!issued) return failure("draft");
        const reference = field(form, "reference", 100);
        const amount = minorUnits(field(form, "amount", 15));
        if (!reference || amount < 1n) return failure("invalid");
        const totals = await db.query<{ total: string; paid: string }>(`
          SELECT ${amountColumns} FROM sales_invoices i WHERE organization_id = $1 AND id = $2
        `, args);
        if (amount > BigInt(totals.rows[0].total) - BigInt(totals.rows[0].paid)) return failure("over");
        const recorded = await db.query(`
          INSERT INTO sales_invoice_receipts (organization_id, invoice_id, reference, amount_minor)
          VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
        `, [...args, reference, amount.toString()]);
        if (!recorded.rowCount) return failure("duplicate");
      } else {
        return failure("invalid");
      }
    }
    await db.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
      VALUES ($1, $2, $3, 'sales_invoice', $4)
    `, [organizationId, session.userId, `invoice.${operation}`, id]);
    return { status: "done", invoiceId: id };
  });
}
