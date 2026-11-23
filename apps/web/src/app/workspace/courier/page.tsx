import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { normalizeTracking, readCourier, updateCourier } from "@/server/courier";

export const metadata = { title: "Courier" };

const stages = {
  booked: { label: "Booked", next: "picked_up", action: "Record pickup" },
  picked_up: { label: "Picked up", next: "in_transit", action: "Mark in transit" },
  in_transit: { label: "In transit", next: "delivered", action: "Record delivery" },
  delivered: { label: "Delivered" },
} as const;

const feedback: Record<string, { text: string; error?: boolean }> = {
  recorded: { text: "Consignment updated." },
  invalid: { text: "Check the consignment details or delivery recipient name.", error: true },
  forbidden: { text: "You do not have permission to update consignments.", error: true },
  unavailable: { text: "The consignment changed or is unavailable. Review its tracking details and try again.", error: true },
  "workspace-changed": { text: "Your active workspace changed. Review this shipment list before trying again.", error: true },
};

const pageSize = 25;
const maxPage = 10_000;

function parsePage(raw: string | undefined) {
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 0 && page <= maxPage ? page : 1;
}

async function changeCourier(organizationId: string, bookingId: string, form: FormData) {
  "use server";
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.organizationId !== organizationId) redirect("/workspace/courier?result=workspace-changed");

  const field = (key: string) => String(form.get(key) ?? "");
  const kind = field("kind");
  const currentTracking = normalizeTracking(field("tracking"));
  let outcome: Awaited<ReturnType<typeof updateCourier>> = { status: "invalid" };
  if (kind === "book") {
    outcome = await updateCourier(organizationId, {
      kind,
      booking: {
        id: bookingId,
        sender: field("sender"),
        recipient: field("recipient"),
        origin: field("origin"),
        destination: field("destination"),
      },
    });
  }
  if (kind === "picked_up" || kind === "in_transit" || kind === "delivered") {
    outcome = await updateCourier(organizationId, {
      kind,
      consignmentId: field("consignmentId"),
      recipient: field("deliveryRecipient"),
    });
  }

  const page = kind === "book" && outcome.status === "recorded" ? 1 : parsePage(field("page"));
  const params = new URLSearchParams({ page: String(page), result: outcome.status });
  const tracking = outcome.tracking ?? currentTracking;
  if (tracking) params.set("tracking", tracking);
  redirect(`/workspace/courier?${params}${tracking ? "#tracking" : ""}`);
}

function courierLink(page: number, tracking: string | null, hash: "tracking" | "consignments") {
  return {
    pathname: "/workspace/courier",
    query: { page, ...(tracking ? { tracking } : {}) },
    hash,
  };
}

const eventDate = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function Courier({ searchParams }: {
  searchParams: Promise<{ page?: string; tracking?: string; result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const page = parsePage(params.page);
  const tracking = normalizeTracking(params.tracking);
  const { allowed, shipments, selected, events } = await readCourier(page, tracking);
  const action = changeCourier.bind(null, session.organizationId, randomUUID());
  const canEdit = session.role !== "member";
  const message = params.result && Object.hasOwn(feedback, params.result) ? feedback[params.result] : undefined;
  const next = selected ? stages[selected.status] : null;
  const nextPage = page < maxPage && shipments.length > pageSize;

  return <>
    <header className="page-heading"><h1>Courier</h1><p>Book consignments and record their handoffs.</p></header>
    {!allowed ? <p className="notice">Your workspace subscription does not currently include access to Courier.</p> : <>
      {message && <p className={message.error ? "notice error" : "notice"} role={message.error ? "alert" : "status"}>{message.text}</p>}
      {canEdit && <section className="panel">
        <h2>Book a consignment</h2>
        <form className="fields contact-form" action={action}>
          <input type="hidden" name="page" value={page} />
          {tracking && <input type="hidden" name="tracking" value={tracking} />}
          <label>Sender name<input name="sender" maxLength={120} required /></label>
          <label>Recipient name<input name="recipient" maxLength={120} required /></label>
          <label>Origin<input name="origin" maxLength={120} required /></label>
          <label>Destination<input name="destination" maxLength={120} required /></label>
          <button type="submit" name="kind" value="book">Book consignment</button>
        </form>
      </section>}
      <section className="panel" id="tracking">
        <h2>Track a consignment</h2>
        <form className="fields contact-form" action="/workspace/courier#tracking" method="get">
          <input type="hidden" name="page" value={page} />
          <label>Tracking code<input name="tracking" defaultValue={tracking ?? undefined} maxLength={35} required /></label>
          <button type="submit">Find consignment</button>
        </form>
        {params.tracking && !selected && <p role="status">No consignment matches that tracking code in this workspace.</p>}
        {selected && <>
          <h3>{selected.tracking_code}</h3>
          <dl className="details">
            <div><dt>Status</dt><dd>{stages[selected.status].label}</dd></div>
            <div><dt>Sender</dt><dd>{selected.sender_name}</dd></div>
            <div><dt>Recipient</dt><dd>{selected.recipient_name}</dd></div>
            <div><dt>Origin</dt><dd>{selected.origin}</dd></div>
            <div><dt>Destination</dt><dd>{selected.destination}</dd></div>
          </dl>
          <div className="table-scroll"><table aria-label="Tracking events">
            <thead><tr><th scope="col">Event</th><th scope="col">Recorded (UTC)</th><th scope="col">Received by</th></tr></thead>
            <tbody>{events.map((event) => <tr key={event.status}>
              <th scope="row">{stages[event.status].label}</th>
              <td><time dateTime={event.occurred_at}>{eventDate.format(new Date(event.occurred_at))}</time></td>
              <td>{event.delivery_recipient ?? "—"}</td>
            </tr>)}</tbody>
          </table></div>
          {canEdit && next && "next" in next && <form className="fields contact-form" action={action}>
            <input type="hidden" name="page" value={page} />
            <input type="hidden" name="tracking" value={selected.tracking_code} />
            <input type="hidden" name="consignmentId" value={selected.id} />
            {next.next === "delivered" && <label>Received by<input name="deliveryRecipient" maxLength={120} required /></label>}
            <button type="submit" name="kind" value={next.next}>{next.action}</button>
          </form>}
        </>}
      </section>
      <section className="panel" id="consignments">
        <h2>Consignments</h2>
        {shipments.length ? <div className="table-scroll"><table aria-label="Consignment directory">
          <thead><tr><th scope="col">Tracking code</th><th scope="col">Origin</th><th scope="col">Destination</th><th scope="col">Status</th></tr></thead>
          <tbody>{shipments.slice(0, pageSize).map((shipment) => <tr key={shipment.id}>
            <th scope="row"><Link href={courierLink(page, shipment.tracking_code, "tracking")}>{shipment.tracking_code}</Link></th>
            <td>{shipment.origin}</td>
            <td>{shipment.destination}</td>
            <td>{stages[shipment.status].label}</td>
          </tr>)}</tbody>
        </table></div> : <p>{page === 1 ? "No consignments yet." : "No consignments on this page."}</p>}
        {(page > 1 || nextPage) && <nav className="pagination" aria-label="Consignment pages">
          {page > 1 && <Link href={courierLink(page - 1, tracking, "consignments")}>Previous</Link>}
          <span>Page {page}</span>
          {nextPage && <Link href={courierLink(page + 1, tracking, "consignments")}>Next</Link>}
        </nav>}
      </section>
    </>}
  </>;
}
