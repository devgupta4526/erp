import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, IdentityError } from "@/server/identity";
import { hotelCurrencies, readHotel, updateHotel } from "@/server/hotel";
import { draftLodgingInvoice } from "@/server/hotel/invoices";
import { listEnabledModules } from "@/server/subscriptions";

export const metadata = { title: "Hotel" };

const pageSize = 25;
const maxPage = 10000;
const results: Record<string, { text: string; error?: boolean }> = {
  "room-added": { text: "Room added." },
  "room-exists": { text: "A room already has that code.", error: true },
  reserved: { text: "Reservation created." },
  "check-in": { text: "Guest checked in." },
  "check-out": { text: "Guest checked out." },
  cancel: { text: "Reservation cancelled." },
  invalid: { text: "Check the room code, guest details, dates, and nightly rate.", error: true },
  forbidden: { text: "You do not have permission to update this hotel.", error: true },
  overlap: { text: "The room is reserved for part of that date range. Choose another room or dates.", error: true },
  "room-missing": { text: "Use an existing room code and an arrival date of today or later.", error: true },
  unavailable: { text: "The reservation could not be updated. Check its dates, status and room occupancy.", error: true },
  "workspace-changed": { text: "Your active workspace changed. Review this hotel's details and try again.", error: true },
  "invoice-unavailable": { text: "An invoice could not be opened. Check the reservation status and subscription.", error: true },
};

const statuses = {
  reserved: "Reserved",
  checked_in: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
};

function readPage(value: string | null | undefined) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= maxPage ? page : 1;
}

async function changeHotel(organizationId: string, form: FormData) {
  "use server";
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.organizationId !== organizationId) redirect("/workspace/hotel?result=workspace-changed");
  const field = (key: string) => String(form.get(key) ?? "");
  const kind = field("kind");
  let result = "invalid";

  if (kind === "add-room") {
    result = await updateHotel(organizationId, { kind, code: field("code"), rate: field("rate"), currency: field("currency") });
  }
  if (kind === "reserve") {
    result = await updateHotel(organizationId, {
      kind, code: field("code"), guestName: field("guest"), arrival: field("arrival"), departure: field("departure"),
    });
  }
  if (kind === "check-in" || kind === "check-out" || kind === "cancel") {
    result = await updateHotel(organizationId, { kind, reservationId: field("reservationId") });
  }
  if (kind === "invoice") {
    try {
      const id = await draftLodgingInvoice(organizationId, field("reservationId"));
      if (id) redirect(`/workspace/invoices/${id}`);
      result = "invoice-unavailable";
    } catch (error) {
      if (!(error instanceof IdentityError)) throw error;
      if (error.code === "UNAUTHENTICATED") redirect("/login");
      result = "forbidden";
    }
  }

  const params = new URLSearchParams({
    result,
    rooms: String(readPage(field("rooms"))),
    stays: String(kind === "reserve" && result === "reserved" ? 1 : readPage(field("stays"))),
  });
  const date = field("date");
  if (date && !(kind === "reserve" && result === "reserved")) params.set("date", date);
  redirect(`/workspace/hotel?${params}`);
}

function HotelPages({ rooms, stays, date, name, hasNext }: {
  rooms: number;
  stays: number;
  date: string | null;
  name: "rooms" | "stays";
  hasNext: boolean;
}) {
  const page = name === "rooms" ? rooms : stays;
  const next = hasNext && page < maxPage;
  if (page === 1 && !next) return null;

  const href = (value: number) => ({
    pathname: "/workspace/hotel",
    query: { rooms, stays, [name]: value, ...(date ? { date } : {}) },
    hash: name,
  });

  return <nav className="pagination" aria-label={name === "rooms" ? "Room pages" : "Reservation pages"}>
    {page > 1 && <Link href={href(page - 1)}>Previous</Link>}
    <span>Page {page}</span>
    {next && <Link href={href(page + 1)}>Next</Link>}
  </nav>;
}

function formatCharge(cents: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);
}

export default async function Hotel({ searchParams }: {
  searchParams: Promise<{ rooms?: string; stays?: string; date?: string; result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const roomPage = readPage(params.rooms);
  const stayPage = readPage(params.stays);
  const [hotel, enabledModules] = await Promise.all([
    readHotel(roomPage, stayPage, params.date),
    listEnabledModules(session.organizationId, session.userId),
  ]);
  const { allowed, rooms, stays, date_filter: date } = hotel;
  const canEdit = session.role !== "member";
  const result = params.result && Object.hasOwn(results, params.result) ? results[params.result] : undefined;
  const hotelAction = changeHotel.bind(null, session.organizationId);

  return <>
    <header className="page-heading"><h1>Hotel</h1><p>Room inventory and reservations for this property.</p></header>
    {!allowed ? <p className="notice">Your workspace subscription does not currently include access to Hotel.</p> : <>
      {result && <p className={result.error ? "notice error" : "notice"} role={result.error ? "alert" : "status"}>{result.text}</p>}
      {canEdit && <section className="panel">
        <h2>Add a room</h2>
        <form className="fields contact-form" action={hotelAction}>
          <input type="hidden" name="rooms" value={roomPage} />
          <input type="hidden" name="stays" value={stayPage} />
          {date && <input type="hidden" name="date" value={date} />}
          <label>Room code<input name="code" placeholder="101" maxLength={24} required /></label>
          <label>Nightly rate<input type="number" name="rate" min="0.01" max="100000" step="0.01" required /></label>
          <label>Currency<select name="currency">{hotelCurrencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          <button type="submit" name="kind" value="add-room">Add room</button>
        </form>
      </section>}
      <section className="panel" id="rooms">
        <h2>Rooms</h2>
        {rooms.length ? <div className="table-scroll"><table aria-label="Rooms">
          <thead><tr><th scope="col">Room code</th><th scope="col">Nightly rate</th></tr></thead>
          <tbody>{rooms.slice(0, pageSize).map((room) => <tr key={room.code}>
            <th scope="row">{room.code}</th><td>{formatCharge(room.nightly_rate_cents, room.currency)}</td>
          </tr>)}</tbody>
        </table></div> : <p>{roomPage === 1 ? "No rooms yet." : "No rooms on this page."}</p>}
        <HotelPages rooms={roomPage} stays={stayPage} date={date} name="rooms" hasNext={rooms.length > pageSize} />
      </section>
      {canEdit && <section className="panel">
        <h2>Reserve a room</h2>
        <p>Use UTC dates. The departure date is excluded from the nightly charge.</p>
        <form className="fields contact-form" action={hotelAction}>
          <input type="hidden" name="rooms" value={roomPage} />
          <input type="hidden" name="stays" value={stayPage} />
          {date && <input type="hidden" name="date" value={date} />}
          <label>Room code<input name="code" list="hotel-room-codes" maxLength={24} required /></label>
          <datalist id="hotel-room-codes">{rooms.slice(0, pageSize).map((room) => <option key={room.code} value={room.code} />)}</datalist>
          <label>Guest name<input name="guest" maxLength={120} required /></label>
          <label>Arrival<input name="arrival" type="date" required /></label>
          <label>Departure<input name="departure" type="date" required /></label>
          <button type="submit" name="kind" value="reserve">Create reservation</button>
        </form>
      </section>}
      <section className="panel" id="stays">
        <h2>Occupancy and reservations</h2>
        <form className="fields contact-form" action="/workspace/hotel#stays" method="get">
          <input type="hidden" name="rooms" value={roomPage} />
          <label>Report date (UTC)<input name="date" type="date" defaultValue={hotel.report_date} min="2000-01-01" max="2099-12-31" required /></label>
          <button type="submit">Filter by date</button>
        </form>
        {date && <Link href={{ pathname: "/workspace/hotel", query: { rooms: roomPage }, hash: "stays" }}>Show all reservations</Link>}
        <dl className="details" aria-label={`Booking totals for ${hotel.report_date}`}>
          <div><dt>Report date (UTC)</dt><dd><time dateTime={hotel.report_date}>{hotel.report_date}</time></dd></div>
          <div><dt>Rooms booked overnight</dt><dd>{hotel.booked_rooms} of {hotel.total_rooms}</dd></div>
          <div><dt>Scheduled arrivals</dt><dd>{hotel.arrivals}</dd></div>
          <div><dt>Scheduled departures</dt><dd>{hotel.departures}</dd></div>
        </dl>
        {stays.length ? <div className="table-scroll"><table aria-label="Hotel reservations">
          <thead><tr><th scope="col">Guest</th><th scope="col">Room</th><th scope="col">Arrival</th><th scope="col">Departure</th><th scope="col">Nights</th><th scope="col">Lodging charge</th><th scope="col">Status</th>{canEdit && <th scope="col">Actions</th>}</tr></thead>
          <tbody>{stays.slice(0, pageSize).map((stay) => <tr key={stay.id}>
            <th scope="row">{stay.guest_name}</th>
            <td>{stay.code}</td>
            <td><time dateTime={stay.arrival}>{stay.arrival}</time></td>
            <td><time dateTime={stay.departure}>{stay.departure}</time></td>
            <td>{stay.nights}</td>
            <td>{stay.status === "cancelled" ? "—" : formatCharge(stay.lodging_charge_cents, stay.currency)}</td>
            <td>{statuses[stay.status]}</td>
            {canEdit && <td>
              {(stay.status === "reserved" || stay.status === "checked_in") && <form className="fields" action={hotelAction}>
                <input type="hidden" name="reservationId" value={stay.id} />
                <input type="hidden" name="rooms" value={roomPage} />
                <input type="hidden" name="stays" value={stayPage} />
                {date && <input type="hidden" name="date" value={date} />}
                {stay.status === "reserved" && stay.can_check_in && <button type="submit" name="kind" value="check-in">Check in</button>}
                {stay.status === "reserved" && <button type="submit" name="kind" value="cancel">Cancel</button>}
                {stay.status === "checked_in" && <button type="submit" name="kind" value="check-out">Check out</button>}
              </form>}
              {stay.status === "checked_out" && enabledModules.has("invoices") && <form action={hotelAction}>
                <input type="hidden" name="reservationId" value={stay.id} />
                <input type="hidden" name="rooms" value={roomPage} />
                <input type="hidden" name="stays" value={stayPage} />
                {date && <input type="hidden" name="date" value={date} />}
                <input type="hidden" name="kind" value="invoice" />
                <button type="submit">Open lodging invoice</button>
              </form>}
            </td>}
          </tr>)}</tbody>
        </table></div> : <p>{date ? "No reservations match this date and page." : stayPage === 1 ? "No reservations yet." : "No reservations on this page."}</p>}
        <HotelPages rooms={roomPage} stays={stayPage} date={date} name="stays" hasNext={stays.length > pageSize} />
      </section>
    </>}
  </>;
}
