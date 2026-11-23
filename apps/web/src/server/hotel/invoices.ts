import "server-only";
import { transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

export async function draftLodgingInvoice(organizationId: string, reservationId: string) {
  const session = await requireMembership(organizationId, ["owner", "admin"]);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(reservationId)) return undefined;
  return transaction(async (db) => {
    const allowed = await db.query(`
      SELECT 1
      FROM organization_subscriptions s
      JOIN plan_modules hotel ON hotel.plan_code = s.plan_code AND hotel.module_code = 'hotel'
      JOIN plan_modules billing ON billing.plan_code = s.plan_code AND billing.module_code = 'invoices'
      JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
      WHERE s.organization_id = $1 AND m.role IN ('owner', 'admin')
        AND s.status IN ('active', 'trialing') AND s.access_until > now()
      FOR SHARE OF s, hotel, billing, m
    `, [organizationId, session.userId]);
    if (!allowed.rowCount) return undefined;
    const locked = await db.query<{ guest_name: string; currency: string; nights: number; nightly_rate_cents: number; code: string }>(`
      SELECT h.guest_name, h.currency, h.departure - h.arrival AS nights, h.nightly_rate_cents, r.code
      FROM hotel_reservations h JOIN hotel_rooms r ON r.organization_id = h.organization_id AND r.id = h.room_id
      WHERE h.organization_id = $1 AND h.id = $2 AND h.status = 'checked_out' FOR UPDATE OF h
    `, [organizationId, reservationId]);
    const stay = locked.rows[0];
    if (!stay) return undefined;
    const existing = await db.query<{ invoice_id: string }>(
      "SELECT invoice_id FROM hotel_invoice_links WHERE organization_id = $1 AND reservation_id = $2",
      [organizationId, reservationId],
    );
    if (existing.rows[0]) return existing.rows[0].invoice_id;
    const draft = await db.query<{ id: string }>(`
      INSERT INTO sales_invoices (organization_id, customer_name, currency) VALUES ($1, $2, $3) RETURNING id
    `, [organizationId, stay.guest_name, stay.currency]);
    const id = draft.rows[0].id;
    await db.query(`
      INSERT INTO sales_invoice_lines (organization_id, invoice_id, description, quantity, unit_minor)
      VALUES ($1, $2, $3, $4, $5)
    `, [organizationId, id, `Lodging for room ${stay.code}`, stay.nights, stay.nightly_rate_cents]);
    await db.query(`
      INSERT INTO hotel_invoice_links (organization_id, reservation_id, invoice_id) VALUES ($1, $2, $3)
    `, [organizationId, reservationId, id]);
    await db.query(`
      INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
      VALUES ($1, $2, 'hotel.invoice.drafted', 'sales_invoice', $3)
    `, [organizationId, session.userId, id]);
    return id;
  });
}
