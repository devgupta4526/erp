import { redirect } from "next/navigation";
import { getSession, IdentityError } from "@/server/identity";
import { readSchedule, updateSchedule } from "@/server/scheduling";

export const metadata = { title: "Schedule" };

const messages: Record<string, string> = {
  done: "Schedule updated.",
  forbidden: "Your workspace, role, or subscription does not allow this action.",
  invalid: "Select a staff member and enter a valid appointment up to 24 hours long.",
  overlap: "This staff member already has an appointment during that time.",
  unavailable: "This appointment has changed or cannot be completed yet.",
};

async function saveAppointment(organizationId: string, selectedDay: string, form: FormData) {
  "use server";
  let result: string;
  try {
    result = await updateSchedule(organizationId, form);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    result = "forbidden";
  }
  const start = String(form.get("start") ?? "");
  const date = result === "done" && /^\d{4}-\d{2}-\d{2}T/.test(start) ? start.slice(0, 10) : selectedDay;
  redirect(`/workspace/schedule?${new URLSearchParams({ date, result })}`);
}

export default async function Schedule({ searchParams }: { searchParams: Promise<{ date?: string; result?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const { allowed, appointments, staff, day } = await readSchedule(session.organizationId, params.date ?? "");
  const canManage = session.role !== "member";
  const save = saveAppointment.bind(null, session.organizationId, day);
  const message = params.result && Object.hasOwn(messages, params.result) ? messages[params.result] : undefined;
  const time = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return <>
    <header className="page-heading"><h1>Schedule</h1><p>Appointment dates and times use UTC.</p></header>
    {!allowed ? <p className="notice">Your subscription does not currently include scheduling.</p> : <>
      {message && <p className="notice" role="status">{message}</p>}
      {canManage && <section className="panel">
        <h2>Book an appointment</h2>
        <form className="fields" action={save}>
          <input name="operation" value="book" type="hidden" />
          <label>Subject<input name="subject" maxLength={120} required /></label>
          <label>Assigned staff<select name="assignee" required>
            {staff.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
          </select></label>
          <label>Starts at (UTC)<input type="datetime-local" name="start" required /></label>
          <label>Ends at (UTC)<input type="datetime-local" name="end" required /></label>
          <button type="submit">Book appointment</button>
        </form>
      </section>}
      <section className="panel">
        <h2>Appointments</h2>
        <form className="fields" method="get">
          <label>Date (UTC)<input type="date" name="date" defaultValue={day} required /></label>
          <button type="submit">Show appointments</button>
        </form>
        {appointments.length > 100 && <p>Showing the first 100 appointments for this date.</p>}
        {appointments.length ? <div className="table-scroll"><table aria-label="Appointments">
          <thead><tr><th scope="col">Subject</th><th scope="col">Staff</th><th scope="col">Starts</th>
            <th scope="col">Ends</th><th scope="col">Status</th>{canManage && <th scope="col">Actions</th>}</tr></thead>
          <tbody>{appointments.slice(0, 100).map((item) => <tr key={item.id}>
            <th scope="row">{item.subject}</th><td>{item.assignee}</td>
            <td>{time.format(new Date(item.starts_at))}</td><td>{time.format(new Date(item.ends_at))}</td><td>{item.status}</td>
            {canManage && <td>{item.status === "scheduled" && <>
              {new Date(item.starts_at).valueOf() <= Date.now() && <form action={save}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="operation" value="complete" />
                <button type="submit">Complete</button>
              </form>}
              <form action={save}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="operation" value="cancel" />
                <button type="submit">Cancel</button>
              </form>
            </>}</td>}
          </tr>)}</tbody>
        </table></div> : <p>No appointments for this date.</p>}
      </section>
    </>}
  </>;
}
