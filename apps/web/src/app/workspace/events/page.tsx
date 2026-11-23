import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { readEvents } from "@/server/events";
import { saveEvent } from "./actions";
import { EventFeedback, EventPages, eventPage, eventTime } from "./presentation";

export const metadata = { title: "Events" };

export default async function Events({ searchParams }: { searchParams: Promise<{ page?: string; result?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const page = eventPage(params.page);
  const { allowed, venues, events } = await readEvents(session.organizationId, page);
  const manage = session.role !== "member";
  const save = saveEvent.bind(null, session.organizationId, null, 1);

  return <>
    <header className="page-heading"><h1>Events</h1><p>Venue bookings and event schedules use UTC.</p></header>
    {!allowed ? <p className="notice">Your subscription does not currently include Events.</p> : <>
      <EventFeedback result={params.result} />
      {manage && <section className="panel">
        <h2>Add a venue</h2>
        <form className="fields" action={save}>
          <input type="hidden" name="operation" value="venue" />
          <label>Venue name<input name="name" maxLength={120} required /></label>
          <label>Venue capacity<input type="number" name="capacity" min="1" max="100000" required /></label>
          <button type="submit">Add venue</button>
        </form>
        {venues.length ? <ul>{venues.map((venue) => <li key={venue.id}>{venue.name} · {venue.capacity} guests</li>)}</ul> : null}
      </section>}
      {manage && venues.length > 0 && <section className="panel">
        <h2>Plan an event</h2>
        <form className="fields" action={save}>
          <input type="hidden" name="operation" value="event" />
          <label>Event name<input name="name" maxLength={120} required /></label>
          <label>Venue<select name="venue" required>{venues.map((venue) =>
            <option key={venue.id} value={venue.id}>{venue.name} ({venue.capacity} guests)</option>)}</select></label>
          <label>Guest limit<input type="number" name="capacity" min="1" max="100000" required /></label>
          <label>Starts (UTC)<input type="datetime-local" name="starts" required /></label>
          <label>Ends (UTC)<input type="datetime-local" name="ends" required /></label>
          <button type="submit">Create event</button>
        </form>
      </section>}
      <section className="panel">
        <h2>Event directory</h2>
        {events.length ? <div className="table-scroll"><table aria-label="Event directory">
          <thead><tr><th scope="col">Event</th><th scope="col">Venue</th><th scope="col">Starts (UTC)</th><th scope="col">Status</th></tr></thead>
          <tbody>{events.slice(0, 25).map((event) => <tr key={event.id}>
            <th scope="row"><Link href={`/workspace/events/${event.id}`}>{event.name}</Link></th>
            <td>{event.venue}</td><td>{eventTime(event.starts_at)}</td><td>{event.status === "canceled" ? "Canceled" : "Planned"}</td>
          </tr>)}</tbody>
        </table></div> : <p>No events on this page.</p>}
        <EventPages page={page} next={events.length > 25} label="Event pages" />
      </section>
    </>}
  </>;
}
