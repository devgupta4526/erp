import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, IdentityError } from "@/server/identity";
import { readFleet, updateFleet } from "@/server/fleet";

export const metadata = { title: "Driver workspace" };

const statuses = { assigned: "Ready for pickup", in_transit: "In transit", delivered: "Delivered", cancelled: "Canceled" };
const feedback: Record<string, string> = {
  depart: "Departure recorded.",
  deliver: "Delivery confirmed.",
  invalid: "Enter the recipient’s name and try again.",
  unavailable: "Your assignment has changed. Review the current job status.",
  forbidden: "This assignment cannot be updated from your current workspace.",
};

async function updateRoute(organizationId: string, page: number, form: FormData) {
  "use server";
  let result: string;
  try {
    result = await updateFleet(organizationId, form, "driver");
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    result = "forbidden";
  }
  redirect(`/workspace/driver?page=${page}&result=${result}`);
}

export default async function DriverWorkspace({ searchParams }: { searchParams: Promise<{ page?: string; result?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const requested = Number(params.page ?? "1");
  const page = Number.isSafeInteger(requested) && requested >= 1 && requested <= 10000 ? requested : 1;
  const { allowed, jobs } = await readFleet(session.organizationId, page, "driver");
  const save = updateRoute.bind(null, session.organizationId, page);
  const message = params.result && Object.hasOwn(feedback, params.result) ? feedback[params.result] : undefined;

  return <>
    <header className="page-heading"><h1>Driver workspace</h1><p>View your assigned stops and record departures and deliveries.</p></header>
    {message && <p className="notice" role="status">{message}</p>}
    {!allowed ? <p className="notice">Your subscription does not currently include the driver workspace.</p> : <>
      {jobs.length === 0 && <p>No assignments on this page.</p>}
      {jobs.slice(0, 25).map((job) => <section className="panel" key={job.id}>
        <header className="page-heading"><h2>{job.reference}</h2><p>{statuses[job.status]} · {job.registration}</p></header>
        <ol>
          <li><strong>Pickup</strong><p>{job.origin}</p></li>
          <li><strong>Delivery</strong><p>{job.destination}</p></li>
        </ol>
        {job.received_by && <p>Received by {job.received_by}</p>}
        {job.status === "assigned" && <form action={save}>
          <input type="hidden" name="operation" value="depart" />
          <input type="hidden" name="jobId" value={job.id} />
          <button type="submit">Record departure</button>
        </form>}
        {job.status === "in_transit" && <form className="fields" action={save}>
          <input type="hidden" name="operation" value="deliver" />
          <input type="hidden" name="jobId" value={job.id} />
          <label>Recipient<input name="recipient" maxLength={120} required /></label>
          <button type="submit">Confirm delivery</button>
        </form>}
      </section>)}
      {(page > 1 || (jobs.length > 25 && page < 10000)) && <nav className="pagination" aria-label="Driver assignment pages">
        {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
        <span>Page {page}</span>
        {jobs.length > 25 && page < 10000 && <Link href={`?page=${page + 1}`}>Next</Link>}
      </nav>}
    </>}
  </>;
}
