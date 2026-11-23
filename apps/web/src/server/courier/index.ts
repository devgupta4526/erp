import "server-only";
import type { PoolClient } from "pg";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

const entitlement = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'courier'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;

type Stage = "booked" | "picked_up" | "in_transit" | "delivered";
type Transition = Exclude<Stage, "booked">;

type Consignment = {
  id: string;
  tracking_code: string;
  sender_name: string;
  recipient_name: string;
  origin: string;
  destination: string;
  status: Stage;
};

type Event = { status: Stage; occurred_at: string; delivery_recipient: string | null };
type CourierOverview = { allowed: boolean; shipments: Consignment[]; selected: Consignment | null; events: Event[] };

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const trackingPattern = /^BS-[0-9A-F]{32}$/;

export function normalizeTracking(value?: string) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return trackingPattern.test(code) ? code : null;
}

export async function readCourier(page: number, tracking: string | null) {
  const session = await requireMembership();
  const { rows } = await pool.query<CourierOverview>(`
    WITH access AS (SELECT 1 ${entitlement}), shipments AS (
      SELECT id, tracking_code, sender_name, recipient_name, origin, destination, status, created_at
      FROM courier_consignments
      WHERE organization_id = $1 AND EXISTS (SELECT 1 FROM access)
      ORDER BY created_at DESC, id DESC LIMIT 26 OFFSET $3
    ), selected AS (
      SELECT id, tracking_code, sender_name, recipient_name, origin, destination, status
      FROM courier_consignments
      WHERE organization_id = $1 AND tracking_code = $4 AND EXISTS (SELECT 1 FROM access)
    ), events AS (
      SELECT e.status, e.occurred_at, e.delivery_recipient,
        array_position(ARRAY['booked', 'picked_up', 'in_transit', 'delivered'], e.status) AS stage
      FROM courier_consignment_events e
      JOIN selected ON selected.id = e.consignment_id
      WHERE e.organization_id = $1
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed,
      COALESCE((SELECT json_agg(shipments ORDER BY created_at DESC, id DESC) FROM shipments), '[]') AS shipments,
      (SELECT row_to_json(selected) FROM selected) AS selected,
      COALESCE((SELECT json_agg(events ORDER BY stage) FROM events), '[]') AS events
  `, [session.organizationId, session.userId, (page - 1) * 25, tracking]);
  return rows[0];
}

type Booking = { id: string; sender: string; recipient: string; origin: string; destination: string };
type CourierMutation = { kind: "book"; booking: Booking } |
  { kind: Transition; consignmentId: string; recipient: string };
type CourierResult = { status: "recorded" | "invalid" | "forbidden" | "unavailable"; tracking?: string };

const priorStage: Record<Transition, Stage> = {
  picked_up: "booked",
  in_transit: "picked_up",
  delivered: "in_transit",
};

function validField(value: string) {
  return value.length > 0 && value.length <= 120 && !/\p{C}/u.test(value);
}

async function recordEvent(
  db: PoolClient, organizationId: string, userId: string, id: string, status: Stage, recipient: string | null,
) {
  await db.query(`
    INSERT INTO courier_consignment_events (organization_id, consignment_id, actor_user_id, status, delivery_recipient)
    VALUES ($1, $2, $3, $4, $5)
  `, [organizationId, id, userId, status, recipient]);
  await db.query(`
    INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
    VALUES ($1, $2, $3, 'courier_consignment', $4)
  `, [organizationId, userId, `courier.${status}`, id]);
}

export async function updateCourier(expectedOrganizationId: string, mutation: CourierMutation): Promise<CourierResult> {
  const session = await requireMembership(expectedOrganizationId);
  const { organizationId, userId } = session;

  return transaction(async (db) => {
    const access = await db.query(`
      SELECT 1 ${entitlement} AND m.role IN ('owner', 'admin') FOR SHARE OF s, p, m
    `, [organizationId, userId]);
    if (!access.rowCount) return { status: "forbidden" };

    if (mutation.kind === "book") {
      const { id, sender, recipient, origin, destination } = mutation.booking;
      const fields = [sender.trim(), recipient.trim(), origin.trim(), destination.trim()];
      if (!uuidPattern.test(id) || !fields.every(validField)) return { status: "invalid" };

      const tracking = "BS-" + id.replaceAll("-", "").toUpperCase();
      const result = await db.query(`
        INSERT INTO courier_consignments (organization_id, id, tracking_code, sender_name, recipient_name, origin, destination)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (organization_id, id) DO NOTHING
      `, [organizationId, id, tracking, ...fields]);

      if (result.rowCount) await recordEvent(db, organizationId, userId, id, "booked", null);
      return { status: "recorded", tracking };
    }

    const { kind, consignmentId } = mutation;
    const recipient = kind === "delivered" ? mutation.recipient.trim() : null;
    if (!uuidPattern.test(consignmentId) || (recipient !== null && !validField(recipient))) {
      return { status: "invalid" };
    }

    const { rows } = await db.query<{ tracking_code: string }>(`
      UPDATE courier_consignments SET status = $3
      WHERE organization_id = $1 AND id = $2 AND status = $4
      RETURNING tracking_code
    `, [organizationId, consignmentId, kind, priorStage[kind]]);
    if (!rows[0]) return { status: "unavailable" };

    await recordEvent(db, organizationId, userId, consignmentId, kind, recipient);
    return { status: "recorded", tracking: rows[0].tracking_code };
  });
}
