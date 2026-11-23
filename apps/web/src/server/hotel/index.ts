import "server-only";
import type { PoolClient } from "pg";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

const hotelAccess = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'hotel'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;
const today = "(now() AT TIME ZONE 'UTC')::date";
const codePattern = /^[A-Z0-9][A-Z0-9-]{0,23}$/;
const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const perPage = 25;
export const hotelCurrencies = ["INR", "USD", "EUR", "GBP"] as const;
type Currency = typeof hotelCurrencies[number];
type StayStatus = "reserved" | "checked_in" | "checked_out" | "cancelled";
type Room = { code: string; nightly_rate_cents: number; currency: Currency };
type Stay = {
  id: string;
  code: string;
  guest_name: string;
  arrival: string;
  departure: string;
  nights: number;
  lodging_charge_cents: number;
  currency: Currency;
  status: StayStatus;
  can_check_in: boolean;
};

type HotelOverview = {
  allowed: boolean;
  rooms: Room[];
  stays: Stay[];
  report_date: string;
  date_filter: string | null;
  total_rooms: number;
  booked_rooms: number;
  arrivals: number;
  departures: number;
};

export async function readHotel(roomPage: number, stayPage: number, dateFilter?: string) {
  const session = await requireMembership();
  const filter = typeof dateFilter === "string" && Number.isFinite(parseDate(dateFilter)) ? dateFilter : null;
  const { rows } = await pool.query<HotelOverview>(`
    WITH access AS (SELECT 1 ${hotelAccess}),
    report_day AS (SELECT COALESCE($5::date, ${today}) AS report_date),
    rooms AS (
      SELECT code, nightly_rate_cents, currency
      FROM hotel_rooms
      WHERE organization_id = $1 AND EXISTS (SELECT 1 FROM access)
      ORDER BY code LIMIT 26 OFFSET $3
    ), stays AS (
      SELECT r.id, rm.code, r.guest_name, to_char(r.arrival, 'YYYY-MM-DD') AS arrival,
        to_char(r.departure, 'YYYY-MM-DD') AS departure,
        r.departure - r.arrival AS nights, r.lodging_charge_cents, r.currency, r.status, r.created_at,
        (${today} >= r.arrival AND ${today} < r.departure AND NOT EXISTS (
          SELECT 1 FROM hotel_reservations occupied
          WHERE occupied.organization_id = r.organization_id AND occupied.room_id = r.room_id
            AND occupied.status = 'checked_in'
        )) AS can_check_in
      FROM hotel_reservations r
      JOIN hotel_rooms rm ON rm.organization_id = r.organization_id AND rm.id = r.room_id
      WHERE r.organization_id = $1 AND EXISTS (SELECT 1 FROM access)
        AND ($5::date IS NULL OR $5::date BETWEEN r.arrival AND r.departure)
      ORDER BY r.created_at DESC, r.id DESC LIMIT 26 OFFSET $4
    ), daily AS (
      SELECT (count(*) FILTER (WHERE r.departure > d.report_date))::integer AS booked_rooms,
        (count(*) FILTER (WHERE r.arrival = d.report_date))::integer AS arrivals,
        (count(*) FILTER (WHERE r.departure = d.report_date))::integer AS departures
      FROM hotel_reservations r
      CROSS JOIN report_day d
      WHERE r.organization_id = $1 AND EXISTS (SELECT 1 FROM access)
        AND r.status IN ('reserved', 'checked_in', 'checked_out')
        AND d.report_date BETWEEN r.arrival AND r.departure
    )
    SELECT EXISTS (SELECT 1 FROM access) AS allowed,
      to_char((SELECT report_date FROM report_day), 'YYYY-MM-DD') AS report_date,
      to_char($5::date, 'YYYY-MM-DD') AS date_filter,
      (SELECT count(*)::integer FROM hotel_rooms
        WHERE organization_id = $1 AND EXISTS (SELECT 1 FROM access)) AS total_rooms,
      daily.*,
      COALESCE((SELECT json_agg(rooms ORDER BY code) FROM rooms), '[]') AS rooms,
      COALESCE((SELECT json_agg(stays ORDER BY created_at DESC, id DESC) FROM stays), '[]') AS stays
    FROM daily
  `, [session.organizationId, session.userId, (roomPage - 1) * perPage, (stayPage - 1) * perPage, filter]);
  return rows[0];
}

type HotelInput =
  | { kind: "add-room"; code: string; rate: string; currency: string }
  | { kind: "reserve"; code: string; guestName: string; arrival: string; departure: string }
  | { kind: "check-in" | "check-out" | "cancel"; reservationId: string };

type HotelResult = "room-added" | "room-exists" | "reserved" | "check-in" | "check-out" | "cancel" |
  "invalid" | "forbidden" | "overlap" | "room-missing" | "unavailable";

type Mutation = { id: string; entity: "hotel_room" | "hotel_reservation"; result: HotelResult };

function parseRate(raw: string) {
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return 0;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function parseDate(raw: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return NaN;
  const stamp = Date.parse(raw + "T00:00:00.000Z");
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === raw ? stamp : NaN;
}

async function addRoom(
  db: PoolClient, organizationId: string, input: Extract<HotelInput, { kind: "add-room" }>,
): Promise<Mutation | HotelResult> {
  const code = input.code.trim().toUpperCase();
  const rate = parseRate(input.rate);
  if (!codePattern.test(code) || rate < 1 || rate > 10_000_000 ||
    !hotelCurrencies.some((currency) => currency === input.currency)) return "invalid";

  const { rows } = await db.query<{ id: string }>(`
    INSERT INTO hotel_rooms (organization_id, code, nightly_rate_cents, currency)
    VALUES ($1, $2, $3, $4) ON CONFLICT (organization_id, code) DO NOTHING RETURNING id
  `, [organizationId, code, rate, input.currency]);
  return rows[0] ? { id: rows[0].id, entity: "hotel_room", result: "room-added" } : "room-exists";
}

async function reserveRoom(
  db: PoolClient, organizationId: string, input: Extract<HotelInput, { kind: "reserve" }>,
): Promise<Mutation | HotelResult> {
  const code = input.code.trim().toUpperCase();
  const guest = input.guestName.trim();
  const nights = (parseDate(input.departure) - parseDate(input.arrival)) / 86_400_000;
  if (!Number.isInteger(nights) || nights < 1 || nights > 365 || !codePattern.test(code) ||
    !guest || guest.length > 120 || /\p{C}/u.test(guest)) return "invalid";

  const { rows } = await db.query<{ id: string }>(`
    INSERT INTO hotel_reservations (organization_id, room_id, guest_name, arrival,
      departure, nightly_rate_cents, currency)
    SELECT organization_id, id, $3, $4::date, $5::date, nightly_rate_cents, currency
      FROM hotel_rooms WHERE organization_id = $1 AND code = $2 AND $4::date >= ${today}
    RETURNING id
  `, [organizationId, code, guest, input.arrival, input.departure]);
  return rows[0] ? { id: rows[0].id, entity: "hotel_reservation", result: "reserved" } : "room-missing";
}

const transitions = {
  "check-in": `SET status = 'checked_in', checked_in_at = now()
    WHERE organization_id = $1 AND id = $2 AND status = 'reserved'
      AND ${today} >= arrival AND ${today} < departure`,
  "check-out": `SET status = 'checked_out', checked_out_at = now()
    WHERE organization_id = $1 AND id = $2 AND status = 'checked_in'`,
  cancel: `SET status = 'cancelled'
    WHERE organization_id = $1 AND id = $2 AND status = 'reserved'`,
} as const;

async function transitionStay(
  db: PoolClient, organizationId: string, input: Extract<HotelInput, { reservationId: string }>,
): Promise<Mutation | HotelResult> {
  if (!uuidPattern.test(input.reservationId)) return "invalid";
  const result = await db.query(`
    UPDATE hotel_reservations ${transitions[input.kind]}
  `, [organizationId, input.reservationId]);
  return result.rowCount
    ? { id: input.reservationId, entity: "hotel_reservation", result: input.kind }
    : "unavailable";
}

export async function updateHotel(expectedOrganizationId: string, input: HotelInput): Promise<HotelResult> {
  const session = await requireMembership(expectedOrganizationId);
  const scope = [session.organizationId, session.userId];
  try {
    return await transaction(async (db) => {
      const access = await db.query(`
        SELECT 1 ${hotelAccess} AND m.role IN ('owner', 'admin') FOR SHARE OF s, p, m
      `, scope);
      if (!access.rowCount) return "forbidden";

      let result: Mutation | HotelResult;
      if (input.kind === "add-room") {
        result = await addRoom(db, session.organizationId, input);
      } else if (input.kind === "reserve") {
        result = await reserveRoom(db, session.organizationId, input);
      } else {
        result = await transitionStay(db, session.organizationId, input);
      }
      if (typeof result === "string") return result;
      await db.query(`
        INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
        VALUES ($1, $2, $3, $4, $5)
      `, [...scope, `hotel.${result.result}`, result.entity, result.id]);
      return result.result;
    });
  } catch (error) {
    if (error instanceof Error && "constraint" in error) {
      if (error.constraint === "hotel_no_overlapping_reservations") return "overlap";
      if (error.constraint === "hotel_room_single_occupant") return "unavailable";
    }
    throw error;
  }
}
