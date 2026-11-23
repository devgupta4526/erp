import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, IdentityError } from "@/server/identity";
import { readFleet, updateFleet } from "@/server/fleet";

export const metadata = { title: "Fleet dispatch" };

const messages: Record<string, string> = {
  vehicle: "Vehicle registered.", driver: "Driver enabled.", assign: "Job assigned.",
  cancel: "Assignment canceled.", depart: "Departure recorded.", deliver: "Delivery recorded.",
  forbidden: "Your role or subscription does not allow this action.",
  invalid: "Check the dispatch details.",
  unavailable: "This job is no longer available for that action.",
  "duplicate-vehicle": "That vehicle registration is already in use.",
  "duplicate-job": "That job reference is already in use.",
  "driver-unavailable": "That workspace member is already a driver or is unavailable.",
  "assignment-overlap": "The vehicle or driver already has an active assignment.",
};
const stages = { assigned: "Assigned", in_transit: "In transit", delivered: "Delivered", cancelled: "Canceled" };

async function saveFleet(organizationId: string, page: number, form: FormData) {
  "use server";
  let result: string;
  try {
    result = await updateFleet(organizationId, form);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    result = "forbidden";
  }
  redirect(`/workspace/fleet?page=${result === "assign" ? 1 : page}&result=${result}`);
}

export default async function FleetPage({ searchParams }: { searchParams: Promise<{ page?: string; result?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const pageNumber = Number(params.page ?? 1);
  const page = Number.isSafeInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 10000 ? pageNumber : 1;
  const { allowed, is_dispatcher: dispatcher, staff, vehicles, jobs } = await readFleet(session.organizationId, page);
  const save = saveFleet.bind(null, session.organizationId, page);
  const message = params.result && Object.hasOwn(messages, params.result) ? messages[params.result] : undefined;
  const drivers = staff.filter((person) => person.driver);
  const otherStaff = staff.filter((person) => !person.driver);

  return <>
    <header className="page-heading"><h1>Fleet dispatch</h1></header>
    {!allowed ? <p className="notice">Your subscription does not currently include Fleet dispatch.</p> : <>
      {message && <p className="notice" role="status">{message}</p>}
      {dispatcher && <>
        <section className="panel">
          <h2>Register a vehicle</h2>
          <form action={save} className="fields">
            <input name="operation" type="hidden" value="vehicle" />
            <label>Registration<input name="registration" maxLength={24} required /></label>
            <label>Vehicle name<input name="name" maxLength={120} required /></label>
            <button type="submit">Register vehicle</button>
          </form>
        </section>
        <section className="panel">
          <h2>Drivers</h2>
          <p>{drivers.length ? drivers.map((driver) => driver.name).join(", ") : "No drivers enabled."}</p>
          {otherStaff.length > 0 && <form action={save} className="fields">
            <input name="operation" type="hidden" value="driver" />
            <label>Workspace member<select name="driverId" required>{otherStaff.map((person) =>
              <option key={person.id} value={person.id}>{person.name}</option>,
            )}</select></label>
            <button type="submit">Enable as driver</button>
          </form>}
        </section>
        <section className="panel">
          <h2>Assign a job</h2>
          {drivers.length && vehicles.length ? <form action={save} className="fields">
            <input name="operation" type="hidden" value="assign" />
            <label>Job reference<input name="reference" maxLength={100} required /></label>
            <label>Pickup address<input name="origin" maxLength={160} required /></label>
            <label>Delivery address<input name="destination" maxLength={160} required /></label>
            <label>Driver<select name="driverId" required>{drivers.map((driver) =>
              <option key={driver.id} value={driver.id}>{driver.name}</option>,
            )}</select></label>
            <label>Vehicle<select name="vehicleId" required>{vehicles.map((vehicle) =>
              <option key={vehicle.id} value={vehicle.id}>{vehicle.registration} · {vehicle.name}</option>,
            )}</select></label>
            <button type="submit">Assign job</button>
          </form> : <p>Register a vehicle and enable a driver to assign a job.</p>}
        </section>
      </>}
      <section className="panel">
        <h2>{dispatcher ? "Dispatch jobs" : "Assigned jobs"}</h2>
        {jobs.length ? <div className="table-scroll"><table aria-label="Fleet dispatch jobs">
          <thead><tr><th scope="col">Job</th><th scope="col">Pickup</th><th scope="col">Delivery</th><th scope="col">Driver</th>
            <th scope="col">Vehicle</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
          <tbody>{jobs.slice(0, 25).map((job) => <tr key={job.id}>
            <th scope="row">{job.reference}</th><td>{job.origin}</td><td>{job.destination}</td>
            <td>{job.driver_name}</td><td>{job.registration}</td><td>{stages[job.status]}{job.received_by && <p>Received by {job.received_by}</p>}</td>
            <td>
              {job.driver_id === session.userId && (job.status === "assigned" || job.status === "in_transit") &&
                <form action={save} className="fields">
                  <input name="jobId" type="hidden" value={job.id} />
                  <input name="operation" type="hidden" value={job.status === "assigned" ? "depart" : "deliver"} />
                  {job.status === "in_transit" && <label>Recipient<input name="recipient" maxLength={120} required /></label>}
                  <button type="submit">{job.status === "assigned" ? "Record departure" : "Record delivery"}</button>
                </form>}
              {dispatcher && job.status === "assigned" && <form action={save}>
                <input name="jobId" type="hidden" value={job.id} />
                <input name="operation" type="hidden" value="cancel" />
                <button type="submit">Cancel assignment</button>
              </form>}
            </td>
          </tr>)}</tbody>
        </table></div> : <p>No jobs on this page.</p>}
        {(page > 1 || (jobs.length > 25 && page < 10000)) && <nav className="pagination" aria-label="Dispatch job pages">
          {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
          <span>Page {page}</span>
          {jobs.length > 25 && page < 10000 && <Link href={`?page=${page + 1}`}>Next</Link>}
        </nav>}
      </section>
    </>}
  </>;
}
