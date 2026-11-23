import Link from "next/link";
import { redirect } from "next/navigation";
import { attendanceDay, readCoaching, writeCoaching } from "@/server/coaching";
import { getSession, IdentityError } from "@/server/identity";

export const metadata = { title: "Coaching" };

const messages: Record<string, string> = {
  done: "Coaching records updated.",
  invalid: "Check the details and try again.",
  duplicate: "A batch with this name already exists.",
  unavailable: "The prospect is unavailable, or attendance predates admission.",
  full: "This batch has reached capacity.",
  forbidden: "Your workspace, role, or subscription does not allow this action.",
};

async function save(organizationId: string, batch: string, day: string, page: number, form: FormData) {
  "use server";
  let result: string;
  try {
    result = await writeCoaching(organizationId, form);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    result = "forbidden";
  }
  redirect(`/workspace/coaching?${new URLSearchParams({ batch, day, page: String(page), result })}`);
}

export default async function Coaching({ searchParams }: {
  searchParams: Promise<{ batch?: string; day?: string; page?: string; result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "member") redirect("/workspace");
  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const selectedDay = attendanceDay(params.day ?? "");
  const day = selectedDay && selectedDay <= today ? selectedDay : today;
  const batch = params.batch ?? "";
  const rawPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 10000 ? rawPage : 1;
  const coaching = await readCoaching(session.organizationId, batch, day, page);
  const action = save.bind(null, session.organizationId, batch, day, page);
  const next = coaching.prospects.length > 25 && page < 10000;
  const href = (number: number) => `?${new URLSearchParams({ batch, day, page: String(number) })}`;
  const message = params.result && Object.hasOwn(messages, params.result) ? messages[params.result] : undefined;

  return <>
    <header className="page-heading"><h1>Coaching</h1><p>Manage batches and attendance for adult learners. Use names only when adding prospects.</p></header>
    {!coaching.allowed ? <p className="notice">Your subscription does not currently include Coaching.</p> : <>
      {message && <p className="notice" role="status">{message}</p>}
      <section className="panel">
        <h2>Batches</h2>
        <form className="fields" action={action}>
          <input type="hidden" name="operation" value="batch" />
          <label>Batch name<input name="name" maxLength={120} required /></label>
          <label>Capacity<input name="capacity" type="number" min="1" max="500" required /></label>
          <button type="submit">Create batch</button>
        </form>
        {coaching.batches.length > 0 && <ul>{coaching.batches.map((option) => <li key={option.id}>
          <Link href={`?${new URLSearchParams({ batch: option.id, day })}#attendance`}>{option.name}</Link> · {option.admissions} of {option.capacity} places filled
        </li>)}</ul>}
      </section>
      <section className="panel">
        <h2>Prospects</h2>
        <form className="fields" action={action}>
          <input type="hidden" name="operation" value="prospect" />
          <label>Prospect name<input name="name" maxLength={120} required /></label>
          <label>I confirm this prospect is an adult<select name="adult" required defaultValue="">
            <option value="" disabled>Select confirmation</option><option value="yes">Confirmed</option>
          </select></label>
          <button type="submit">Add prospect</button>
        </form>
        {coaching.prospects.length ? <div className="table-scroll"><table aria-label="Coaching prospects">
          <thead><tr><th scope="col">Name</th><th scope="col">Admission</th></tr></thead>
          <tbody>{coaching.prospects.slice(0, 25).map((prospect) => <tr key={prospect.id}>
            <th scope="row">{prospect.name}</th><td>{coaching.batches.length ? <form className="fields" action={action}>
              <input type="hidden" name="operation" value="admit" />
              <input type="hidden" name="prospectId" value={prospect.id} />
              <label>Batch for {prospect.name}<select name="batchId" required>{coaching.batches.map((option) =>
                <option key={option.id} value={option.id}>{option.name} ({option.admissions}/{option.capacity})</option>)}</select></label>
              <button type="submit">Admit prospect</button>
            </form> : "Create a batch to admit this prospect."}</td>
          </tr>)}</tbody>
        </table></div> : <p>No prospects awaiting admission on this page.</p>}
        {(page > 1 || next) && <nav className="pagination" aria-label="Prospect pages">
          {page > 1 && <Link href={href(page - 1)}>Previous</Link>}<span>Page {page}</span>{next && <Link href={href(page + 1)}>Next</Link>}
        </nav>}
      </section>
      <section className="panel" id="attendance">
        <h2>Batch attendance</h2>
        {coaching.batches.length > 0 && <form className="fields" method="get">
          <label>Batch<select name="batch" defaultValue={batch} required>
            <option value="" disabled>Select a batch</option>
            {coaching.batches.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select></label>
          <label>Date (UTC)<input name="day" type="date" max={today} defaultValue={day} required /></label>
          <button type="submit">Show attendance</button>
        </form>}
        {coaching.learners.length ? <div className="table-scroll"><table aria-label="Batch attendance">
          <thead><tr><th scope="col">Learner</th><th scope="col">Attendance</th><th scope="col">Record status</th></tr></thead>
          <tbody>{coaching.learners.map((learner) => <tr key={learner.id}>
            <th scope="row">{learner.name}</th><td>{learner.status === "present" ? "Present" : learner.status === "absent" ? "Absent" : "Unrecorded"}</td>
            <td>{learner.admitted_on <= day ? <form className="fields" action={action}>
              <input type="hidden" name="operation" value="attendance" />
              <input type="hidden" name="batchId" value={batch} />
              <input type="hidden" name="prospectId" value={learner.id} />
              <input type="hidden" name="day" value={day} />
              <label>Status for {learner.name}<select name="status" defaultValue={learner.status ?? ""} required>
                <option value="" disabled>Select status</option><option value="present">Present</option><option value="absent">Absent</option>
              </select></label>
              <button type="submit">Save attendance</button>
            </form> : "Admitted after this date"}</td>
          </tr>)}</tbody>
        </table></div> : <p>{batch ? "No learners in this batch." : "Select a batch to view its roster."}</p>}
      </section>
    </>}
  </>;
}
