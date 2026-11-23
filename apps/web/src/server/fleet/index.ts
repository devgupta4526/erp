import "server-only";
import { pool, transaction } from "@/server/db";
import { requireMembership } from "@/server/identity";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const plate = /^[A-Z0-9][A-Z0-9 -]{0,23}$/;
function fleetAccess(surface: "dispatch" | "driver") {
  const moduleKey = surface === "dispatch" ? "fleet" : "driver-navigation";
  return `
  FROM organization_subscriptions s
  JOIN plan_modules p ON p.plan_code = s.plan_code AND p.module_code = '${moduleKey}'
  JOIN organization_memberships m ON m.organization_id = s.organization_id AND m.user_id = $2
  WHERE s.organization_id = $1 AND s.status IN ('trialing','active') AND s.access_until > now()
`;
}
type Job = {
  id: string; driver_id: string; reference: string; origin: string; destination: string;
  status: "assigned" | "in_transit" | "delivered" | "cancelled";
  driver_name: string; registration: string; received_by: string | null;
};
type Fleet = {
  allowed: boolean; is_dispatcher: boolean; jobs: Job[];
  staff: { id: string; name: string; driver: boolean }[];
  vehicles: { id: string; name: string; registration: string }[];
};

export async function readFleet(organizationId: string, page: number, surface: "dispatch" | "driver" = "dispatch") {
  const session = await requireMembership(organizationId);
  const dispatcher = surface === "dispatch" ? "m.role IN ('owner','admin')" : "false";
  const { rows } = await pool.query<Fleet>(`
    WITH enabled AS (SELECT ${dispatcher} AS dispatcher ${fleetAccess(surface)}), jobs AS (
      SELECT j.id, j.driver_id, j.reference, j.origin, j.destination, j.status, j.received_by, j.assigned_at,
        u.name AS driver_name, v.registration
      FROM fleet_jobs j
      JOIN users u ON u.id = j.driver_id
      JOIN fleet_vehicles v ON v.organization_id = j.organization_id AND v.id = j.vehicle_id
      WHERE j.organization_id = $1 AND EXISTS (
        SELECT 1 FROM enabled WHERE dispatcher OR j.driver_id = $2
      )
      ORDER BY j.assigned_at DESC, j.id DESC LIMIT 26 OFFSET $3
    ), staff AS (
      SELECT u.id, u.name, d.user_id IS NOT NULL AS driver
      FROM organization_memberships m JOIN users u ON u.id = m.user_id
      LEFT JOIN fleet_drivers d ON d.organization_id = m.organization_id AND d.user_id = m.user_id
      WHERE m.organization_id = $1 AND EXISTS (SELECT 1 FROM enabled WHERE dispatcher)
    ), vehicles AS (
      SELECT id, name, registration FROM fleet_vehicles
      WHERE organization_id = $1 AND EXISTS (SELECT 1 FROM enabled WHERE dispatcher)
    )
    SELECT EXISTS (SELECT 1 FROM enabled) AS allowed,
      EXISTS (SELECT 1 FROM enabled WHERE dispatcher) AS is_dispatcher,
      coalesce((SELECT json_agg(jobs ORDER BY assigned_at DESC, id DESC) FROM jobs), '[]') AS jobs,
      coalesce((SELECT json_agg(staff ORDER BY lower(name), id) FROM staff), '[]') AS staff,
      coalesce((SELECT json_agg(vehicles ORDER BY registration) FROM vehicles), '[]') AS vehicles
  `, [organizationId, session.userId, (page - 1) * 25]);
  return rows[0];
}

function formText(form: FormData, key: string, limit: number) {
  const value = String(form.get(key) ?? "").trim();
  return value.length <= limit && !/\p{C}/u.test(value) ? value : "";
}

export async function updateFleet(organizationId: string, form: FormData, surface: "dispatch" | "driver" = "dispatch") {
  const session = await requireMembership(organizationId);
  const operation = form.get("operation");
  if (surface === "driver" && operation !== "depart" && operation !== "deliver") return "forbidden";
  try {
    return await transaction(async (db) => {
      const enabled = await db.query<{ dispatcher: boolean }>(`
        SELECT m.role IN ('owner','admin') AS dispatcher ${fleetAccess(surface)} FOR SHARE OF s, p, m
      `, [organizationId, session.userId]);
      const permission = enabled.rows[0];
      if (!permission || (!permission.dispatcher && operation !== "depart" && operation !== "deliver")) return "forbidden";
      let id: string;
      let entity = "fleet_job";
      if (operation === "vehicle") {
        const name = formText(form, "name", 120);
        const registration = formText(form, "registration", 24).toUpperCase().replace(/ +/g, " ");
        if (!name || !plate.test(registration)) return "invalid";
        const { rows } = await db.query<{ id: string }>(`
          INSERT INTO fleet_vehicles (organization_id, registration, name) VALUES ($1,$2,$3)
          ON CONFLICT (organization_id, registration) DO NOTHING RETURNING id
        `, [organizationId, registration, name]);
        if (!rows[0]) return "duplicate-vehicle";
        id = rows[0].id;
        entity = "fleet_vehicle";
      } else if (operation === "driver") {
        id = formText(form, "driverId", 36);
        if (!uuid.test(id)) return "invalid";
        const registered = await db.query(`
          INSERT INTO fleet_drivers (organization_id, user_id)
          SELECT organization_id, user_id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2
          ON CONFLICT DO NOTHING
        `, [organizationId, id]);
        if (!registered.rowCount) return "driver-unavailable";
        entity = "fleet_driver";
      } else if (operation === "assign") {
        const driver = formText(form, "driverId", 36);
        const vehicle = formText(form, "vehicleId", 36);
        const reference = formText(form, "reference", 100);
        const origin = formText(form, "origin", 160);
        const destination = formText(form, "destination", 160);
        if (!uuid.test(driver) || !uuid.test(vehicle) || !reference || !origin || !destination) return "invalid";
        const { rows } = await db.query<{ id: string }>(`
          INSERT INTO fleet_jobs (organization_id, vehicle_id, driver_id, reference, origin, destination)
          SELECT v.organization_id, v.id, d.user_id, $4, $5, $6 FROM fleet_vehicles v
          JOIN fleet_drivers d ON d.organization_id = v.organization_id AND d.user_id = $3
          JOIN organization_memberships m ON m.organization_id = d.organization_id AND m.user_id = d.user_id
          WHERE v.organization_id = $1 AND v.id = $2 RETURNING id
        `, [organizationId, vehicle, driver, reference, origin, destination]);
        if (!rows[0]) return "invalid";
        id = rows[0].id;
      } else {
        id = formText(form, "jobId", 36);
        if (!uuid.test(id)) return "invalid";
        const keys = [organizationId, id];
        if (operation === "cancel") {
          const changed = await db.query(`
            UPDATE fleet_jobs SET status = 'cancelled' WHERE organization_id = $1 AND id = $2 AND status = 'assigned'
          `, keys);
          if (!changed.rowCount) return "unavailable";
        } else if (operation === "depart") {
          const changed = await db.query(`
            UPDATE fleet_jobs SET status = 'in_transit', departed_at = now()
            WHERE organization_id = $1 AND id = $2 AND driver_id = $3 AND status = 'assigned'
          `, [...keys, session.userId]);
          if (!changed.rowCount) return "unavailable";
        } else if (operation === "deliver") {
          const recipient = formText(form, "recipient", 120);
          if (!recipient) return "invalid";
          const changed = await db.query(`
            UPDATE fleet_jobs SET status = 'delivered', delivered_at = now(), received_by = $4
            WHERE organization_id = $1 AND id = $2 AND driver_id = $3 AND status = 'in_transit'
          `, [...keys, session.userId, recipient]);
          if (!changed.rowCount) return "unavailable";
        } else {
          return "invalid";
        }
      }
      await db.query(`
        INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
        VALUES ($1,$2,$3,$4,$5)
      `, [organizationId, session.userId, `fleet.${operation}`, entity, id]);
      return operation;
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return "constraint" in error && error.constraint === "fleet_jobs_organization_id_reference_key"
        ? "duplicate-job" : "assignment-overlap";
    }
    throw error;
  }
}
