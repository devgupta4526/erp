import "server-only";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

export const rentalCurrencies = ["INR", "USD", "EUR", "GBP"] as const;
const today = "(now() AT TIME ZONE 'UTC')::date";
const access = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'car-rental'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('active','trialing') AND s.access_until > now()
`;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const plate = /^[A-Z0-9][A-Z0-9 -]{0,23}$/;
type Vehicle = { registration: string; display_name: string; daily_minor: number; currency: string };
type Booking = {
  id: string;
  renter_name: string;
  registration: string;
  starts_on: string;
  due_on: string;
  quoted_minor: string;
  currency: string;
  status: "booked" | "out" | "returned" | "cancelled";
  pickup_notes: string | null;
  return_notes: string | null;
  can_pick_up: boolean;
};

export async function readRentals(organizationId: string, bookingsPage: number, vehiclePage: number) {
  const session = await requireMembership(organizationId);
  const { rows } = await pool.query<{ allowed: boolean; vehicles: Vehicle[]; bookings: Booking[] }>(`
    WITH enabled AS (SELECT 1 ${access}), vehicles AS (
      SELECT registration, display_name, daily_minor, currency FROM rental_vehicles
      WHERE organization_id = $1 AND EXISTS (SELECT 1 FROM enabled)
      ORDER BY registration LIMIT 26 OFFSET $4
    ), bookings AS (
      SELECT b.id, b.renter_name, v.registration, to_char(b.starts_on, 'YYYY-MM-DD') AS starts_on,
        to_char(b.due_on, 'YYYY-MM-DD') AS due_on, b.quoted_minor::text, b.currency, b.status,
        b.pickup_notes, b.return_notes, b.created_at,
        (${today} >= b.starts_on AND ${today} < b.due_on AND NOT EXISTS (
          SELECT 1 FROM rental_bookings active WHERE active.organization_id = b.organization_id
            AND active.vehicle_id = b.vehicle_id AND active.status = 'out'
        )) AS can_pick_up
      FROM rental_bookings b JOIN rental_vehicles v ON v.organization_id = b.organization_id AND v.id = b.vehicle_id
      WHERE b.organization_id = $1 AND EXISTS (SELECT 1 FROM enabled)
      ORDER BY b.created_at DESC, b.id DESC LIMIT 26 OFFSET $3
    )
    SELECT EXISTS (SELECT 1 FROM enabled) AS allowed,
      coalesce((SELECT json_agg(vehicles ORDER BY registration) FROM vehicles), '[]') AS vehicles,
      coalesce((SELECT json_agg(bookings ORDER BY created_at DESC, id DESC) FROM bookings), '[]') AS bookings
  `, [organizationId, session.userId, (bookingsPage - 1) * 25, (vehiclePage - 1) * 25]);
  return rows[0];
}

function readDate(value: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return NaN;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? date.valueOf() : NaN;
}

function readRate(value: string) {
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value)) return 0;
  const [units, fraction = ""] = value.split(".");
  return Number(units) * 100 + Number(fraction.padEnd(2, "0"));
}

export async function changeRental(organizationId: string, form: FormData) {
  const session = await requireMembership(organizationId, ["owner", "admin"]);
  const get = (key: string) => String(form.get(key) ?? "").trim();
  const operation = get("operation");
  const registration = get("registration").toUpperCase().replace(/\s+/g, " ");
  const scope = [organizationId, session.userId];
  try {
    return await transaction(async (db) => {
      const enabled = await db.query(`
        SELECT 1 ${access} AND m.role IN ('owner','admin') FOR SHARE OF s, p, m
      `, scope);
      if (!enabled.rowCount) return "forbidden";
      let id: string;
      let entity = "rental_booking";
      if (operation === "vehicle") {
        const displayName = get("vehicleName");
        const rate = readRate(get("rate"));
        const currency = get("currency");
        if (!plate.test(registration) || !displayName || displayName.length > 120 || /\p{C}/u.test(displayName) ||
            rate < 1 || rate > 100000000 || !rentalCurrencies.some((entry) => entry === currency)) return "invalid";
        const { rows } = await db.query<{ id: string }>(`
          INSERT INTO rental_vehicles (organization_id, registration, display_name, daily_minor, currency)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (organization_id, registration) DO NOTHING RETURNING id
        `, [organizationId, registration, displayName, rate, currency]);
        if (!rows[0]) return "duplicate";
        id = rows[0].id;
        entity = "rental_vehicle";
      } else if (operation === "book") {
        const renter = get("renterName");
        const starts = get("startsOn");
        const due = get("dueOn");
        const length = (readDate(due) - readDate(starts)) / 86400000;
        if (!plate.test(registration) || !renter || renter.length > 120 || /\p{C}/u.test(renter) ||
            !Number.isInteger(length) || length < 1 || length > 365) return "invalid";
        const { rows } = await db.query<{ id: string }>(`
          INSERT INTO rental_bookings (organization_id, vehicle_id, renter_name, starts_on, due_on, daily_minor, currency)
          SELECT organization_id, id, $3, $4, $5, daily_minor, currency FROM rental_vehicles
          WHERE organization_id = $1 AND registration = $2 AND $4::date >= ${today} RETURNING id
        `, [organizationId, registration, renter, starts, due]);
        if (!rows[0]) return "unavailable";
        id = rows[0].id;
      } else {
        id = get("bookingId");
        const notes = get("notes");
        if (!uuid.test(id) || (operation !== "cancel" && operation !== "pickup" && operation !== "return")) return "invalid";
        if (operation !== "cancel" && (!notes || notes.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(notes))) return "invalid";

        const actionSql = {
          pickup: `UPDATE rental_bookings SET status = 'out', picked_up_at = now(), pickup_notes = $3
            WHERE organization_id = $1 AND id = $2 AND status = 'booked'
              AND ${today} >= starts_on AND ${today} < due_on`,
          return: `UPDATE rental_bookings SET status = 'returned', returned_at = now(), return_notes = $3
            WHERE organization_id = $1 AND id = $2 AND status = 'out'`,
          cancel: `UPDATE rental_bookings SET status = 'cancelled'
            WHERE organization_id = $1 AND id = $2 AND status = 'booked'`,
        };
        const changed = await db.query(actionSql[operation], operation === "cancel" ? [organizationId, id] : [organizationId, id, notes]);
        if (!changed.rowCount) return "unavailable";
      }
      await db.query(`
        INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
        VALUES ($1,$2,$3,$4,$5)
      `, [...scope, `car_rental.${operation}`, entity, id]);
      return operation;
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error) {
      if (error.code === "23P01") return "overlap";
      if (error.code === "23505") return "unavailable";
    }
    throw error;
  }
}
