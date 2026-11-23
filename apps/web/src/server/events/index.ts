import "server-only";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

const entitlement = `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = 'events'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing', 'active') AND s.access_until > now()
`;

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const responses = ["pending", "confirmed", "declined"];
type Venue = { id: string; name: string; capacity: number };
type Event = { id: string; name: string; venue: string; starts_at: string; ends_at: string; capacity: number; status: string };
type Guest = { id: string; name: string; email: string; response: string };
type ScheduleItem = { id: string; name: string; starts_at: string; ends_at: string };

const eventFields = "e.id, e.name, e.starts_at, e.ends_at, e.status, e.capacity, v.name AS venue";

function safeName(value: string) {
  return value.length >= 1 && value.length <= 120 && !/\p{C}/u.test(value);
}

function utcDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 16) === value ? date : undefined;
}

export async function readEvents(organizationId: string, page: number) {
  const session = await requireMembership(organizationId);
  const { rows } = await pool.query<{ allowed: boolean; venues: Venue[]; events: Event[] }>(`
    WITH scope AS (SELECT 1 ${entitlement}),
    list AS (
      SELECT ${eventFields} FROM managed_events e
      JOIN event_venues v ON v.organization_id = e.organization_id AND v.id = e.venue_id
      WHERE e.organization_id = $1 AND EXISTS (SELECT 1 FROM scope)
      ORDER BY e.starts_at DESC, e.id DESC LIMIT 26 OFFSET $3
    ), venues AS (
      SELECT id, name, capacity FROM event_venues WHERE organization_id = $1 AND EXISTS (SELECT 1 FROM scope)
    )
    SELECT EXISTS (SELECT 1 FROM scope) AS allowed,
      COALESCE((SELECT json_agg(list ORDER BY starts_at DESC, id DESC) FROM list), '[]') AS events,
      COALESCE((SELECT json_agg(venues ORDER BY lower(name), id) FROM venues), '[]') AS venues
  `, [organizationId, session.userId, (page - 1) * 25]);
  return rows[0];
}

export async function readEvent(organizationId: string, eventId: string, page: number) {
  const session = await requireMembership(organizationId);
  if (!uuid.test(eventId)) return undefined;
  const { rows } = await pool.query<{
    event: Event; guests: Guest[]; schedule: ScheduleItem[]; confirmed: number;
  }>(`
    WITH scope AS (SELECT m.role ${entitlement}),
    selected AS (
      SELECT ${eventFields} FROM managed_events e
      JOIN event_venues v ON v.organization_id = e.organization_id AND v.id = e.venue_id
      WHERE e.organization_id = $1 AND e.id = $3 AND EXISTS (SELECT 1 FROM scope)
    ), guests AS (
      SELECT id, name, email, response FROM event_guests
      WHERE organization_id = $1 AND event_id = $3 AND EXISTS (SELECT 1 FROM scope WHERE role IN ('owner', 'admin'))
      ORDER BY lower(name), id LIMIT 26 OFFSET $4
    ), schedule AS (
      SELECT id, name, starts_at, ends_at FROM event_schedule_items
      WHERE organization_id = $1 AND event_id = $3
    )
    SELECT row_to_json(selected) AS event,
      COALESCE((SELECT json_agg(guests ORDER BY lower(name), id) FROM guests), '[]') AS guests,
      COALESCE((SELECT json_agg(schedule ORDER BY starts_at, id) FROM schedule), '[]') AS schedule,
      (SELECT count(*)::int FROM event_guests WHERE organization_id = $1 AND event_id = $3 AND response = 'confirmed') AS confirmed
    FROM selected
  `, [organizationId, session.userId, eventId, (page - 1) * 25]);
  return rows[0];
}

export async function updateEvents(organizationId: string, eventId: string | null, form: FormData) {
  const session = await requireMembership(organizationId, ["owner", "admin"]);
  const operation = form.get("operation");
  const field = (key: string) => String(form.get(key) ?? "").trim();
  const name = field("name");
  const starts = utcDate(field("starts"));
  const ends = utcDate(field("ends"));
  try {
    return await transaction(async (db) => {
      const authorized = await db.query(
        `SELECT 1 ${entitlement} AND m.role IN ('owner', 'admin') FOR SHARE OF s, p, m`,
        [organizationId, session.userId],
      );
      if (!authorized.rowCount) return { status: "forbidden" };

      let id: string;
      let entityType = "event";
      let resultEventId = eventId;
      if (operation === "venue" || operation === "event") {
        const capacity = Number(field("capacity"));
        if (!safeName(name) || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100000 || eventId) {
          return { status: "invalid" };
        }
        if (operation === "venue") {
          const inserted = await db.query<{ id: string }>(`
            INSERT INTO event_venues (organization_id, name, capacity) VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING RETURNING id
          `, [organizationId, name, capacity]);
          if (!inserted.rows[0]) return { status: "duplicate" };
          id = inserted.rows[0].id;
          entityType = "event_venue";
        } else {
          const venueId = field("venue");
          if (!uuid.test(venueId) || !starts || !ends || ends <= starts) return { status: "invalid" };
          const inserted = await db.query<{ id: string }>(`
            INSERT INTO managed_events (organization_id, venue_id, name, capacity, starts_at, ends_at)
            SELECT organization_id, id, $3, $4, $5, $6 FROM event_venues
            WHERE organization_id = $1 AND id = $2 AND capacity >= $4
            RETURNING id
          `, [organizationId, venueId, name, capacity, starts, ends]);
          if (!inserted.rows[0]) return { status: "venue-capacity" };
          id = inserted.rows[0].id;
          resultEventId = id;
        }
      } else {
        if (!eventId || !uuid.test(eventId)) return { status: "invalid" };
        const scope = [organizationId, eventId];
        const locked = await db.query<{ capacity: number; starts_at: Date; ends_at: Date; status: string }>(`
          SELECT capacity, starts_at, ends_at, status FROM managed_events WHERE organization_id = $1 AND id = $2 FOR UPDATE
        `, scope);
        const event = locked.rows[0];
        if (!event || event.status !== "planned") return { status: "unavailable" };

        if (operation === "guest") {
          const email = field("email").toLowerCase();
          if (!safeName(name) || email.length > 254 || !/^[^\s@\p{C}]+@[^\s@\p{C}]+\.[^\s@\p{C}]+$/u.test(email)) {
            return { status: "invalid" };
          }
          const { rows } = await db.query<{ id: string }>(`
            INSERT INTO event_guests (organization_id, event_id, name, email) VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING RETURNING id
          `, [...scope, name, email]);
          if (!rows[0]) return { status: "duplicate" };
          id = rows[0].id;
          entityType = "event_guest";
        } else if (operation === "rsvp") {
          id = field("guestId");
          const response = field("response");
          const previous = field("previous");
          if (!uuid.test(id) || !responses.includes(response) || !responses.includes(previous)) return { status: "invalid" };
          const guest = await db.query<{ response: string }>(
            "SELECT response FROM event_guests WHERE organization_id = $1 AND event_id = $2 AND id = $3", [...scope, id],
          );
          if (!guest.rows[0] || guest.rows[0].response !== previous) return { status: "unavailable" };
          if (previous === response) return { status: "done", eventId };
          if (response === "confirmed") {
            const confirmed = await db.query<{ count: number }>(`
              SELECT count(*)::int AS count FROM event_guests WHERE organization_id = $1 AND event_id = $2 AND response = 'confirmed'
            `, scope);
            if (confirmed.rows[0].count >= event.capacity) return { status: "full" };
          }
          await db.query(`
            UPDATE event_guests SET response = $4 WHERE organization_id = $1 AND event_id = $2 AND id = $3
          `, [...scope, id, response]);
          entityType = "event_guest";
        } else if (operation === "schedule") {
          if (!safeName(name) || !starts || !ends || ends <= starts || starts < event.starts_at || ends > event.ends_at) {
            return { status: "schedule-window" };
          }
          const { rows } = await db.query<{ id: string }>(`
            INSERT INTO event_schedule_items (organization_id, event_id, name, starts_at, ends_at)
            VALUES ($1, $2, $3, $4, $5) RETURNING id
          `, [...scope, name, starts, ends]);
          id = rows[0].id;
          entityType = "event_schedule_item";
        } else if (operation === "cancel") {
          await db.query("UPDATE managed_events SET status = 'canceled' WHERE organization_id = $1 AND id = $2", scope);
          id = eventId;
        } else {
          return { status: "invalid" };
        }
      }
      await db.query(`
        INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
        VALUES ($1, $2, $3, $4, $5)
      `, [organizationId, session.userId, `events.${operation}`, entityType, id]);
      return { status: "done", eventId: resultEventId };
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23P01") return { status: "overlap" };
    throw error;
  }
}
