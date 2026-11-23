import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { readEvent } from "@/server/events";
import { saveEvent } from "../actions";
import { EventFeedback, EventPages, eventPage, eventTime } from "../presentation";

const responseLabels: Record<string, string> = { pending: "Pending", confirmed: "Confirmed", declined: "Declined" };

export default async function EventPage({ params, searchParams }: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ page?: string; result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { eventId } = await params;
  const query = await searchParams;
  const page = eventPage(query.page);
  const record = await readEvent(session.organizationId, eventId, page);
  if (!record) notFound();
  const { event, guests, schedule, confirmed } = record;
  const staff = session.role !== "member";
  const manage = staff && event.status === "planned";
  const save = saveEvent.bind(null, session.organizationId, event.id, page);

  return <>
    <header className="page-heading">
      <Link href="/workspace/events">Events</Link>
      <h1>{event.name}</h1>
      <p>{event.venue} · {eventTime(event.starts_at)} to {eventTime(event.ends_at)} UTC{event.status === "canceled" && " · Canceled"}</p>
    </header>
    <EventFeedback result={query.result} />
    <section className="panel">
      <h2>Run of show</h2>
      {schedule.length ? <div className="table-scroll"><table aria-label="Event schedule">
        <thead><tr><th scope="col">Session</th><th scope="col">Starts (UTC)</th><th scope="col">Ends (UTC)</th></tr></thead>
        <tbody>{schedule.map((item) => <tr key={item.id}>
          <th scope="row">{item.name}</th><td>{eventTime(item.starts_at)}</td><td>{eventTime(item.ends_at)}</td>
        </tr>)}</tbody>
      </table></div> : <p>No sessions scheduled.</p>}
      {manage && <form className="fields" action={save}>
        <input type="hidden" name="operation" value="schedule" />
        <label>Session name<input name="name" maxLength={120} required /></label>
        <label>Session starts (UTC)<input type="datetime-local" name="starts" required /></label>
        <label>Session ends (UTC)<input type="datetime-local" name="ends" required /></label>
        <button type="submit">Add session</button>
      </form>}
    </section>
    {staff && <section className="panel">
      <h2>Guest roster</h2>
      <p>{confirmed} of {event.capacity} guest places confirmed.</p>
      {manage && <form className="fields" action={save}>
        <input type="hidden" name="operation" value="guest" />
        <label>Guest name<input name="name" maxLength={120} required /></label>
        <label>Guest email<input name="email" type="email" maxLength={254} required /></label>
        <button type="submit">Add to guest roster</button>
      </form>}
      {guests.length ? <div className="table-scroll"><table aria-label="Guest roster">
        <thead><tr><th scope="col">Guest</th><th scope="col">Email</th><th scope="col">RSVP</th>{manage && <th scope="col">Update RSVP</th>}</tr></thead>
        <tbody>{guests.slice(0, 25).map((guest) => <tr key={guest.id}>
          <th scope="row">{guest.name}</th><td>{guest.email}</td><td>{responseLabels[guest.response]}</td>
          {manage && <td><form className="fields" action={save}>
            <input type="hidden" name="operation" value="rsvp" />
            <input type="hidden" name="guestId" value={guest.id} />
            <input type="hidden" name="previous" value={guest.response} />
            <label>Response for {guest.name}<select name="response" defaultValue={guest.response}>
              {Object.entries(responseLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <button type="submit">Save RSVP</button>
          </form></td>}
        </tr>)}</tbody>
      </table></div> : <p>No guests on this page.</p>}
      <EventPages page={page} next={guests.length > 25} label="Guest pages" />
    </section>}
    {manage && <section className="panel">
      <h2>Cancel event</h2>
      <p>Cancellation releases this venue time and freezes the guest roster and schedule.</p>
      <form action={save}>
        <input type="hidden" name="operation" value="cancel" />
        <button type="submit">Cancel event</button>
      </form>
    </section>}
  </>;
}
