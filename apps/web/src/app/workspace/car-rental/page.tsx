import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, IdentityError } from "@/server/identity";
import { changeRental, readRentals, rentalCurrencies } from "@/server/car-rental";

export const metadata = { title: "Car rental" };

const messages: Record<string, string> = {
  vehicle: "Vehicle added.",
  book: "Vehicle booked.",
  pickup: "Pickup inspection recorded.",
  return: "Return inspection recorded.",
  cancel: "Booking canceled.",
  duplicate: "That registration is already in the fleet.",
  forbidden: "Your workspace, role, or subscription does not allow this action.",
  invalid: "Check the details and use a rental period of 1 to 365 days.",
  overlap: "This vehicle already has a booking for those dates.",
  unavailable: "The vehicle or booking is unavailable for this action. Check the registration, dates and status.",
};

const statusLabels = { booked: "Booked", out: "Picked up", returned: "Returned", cancelled: "Canceled" };

function pageNumber(value: string | undefined) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 10000 ? page : 1;
}

function amount(minor: number | string, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "code" }).format(Number(minor) / 100);
}

async function saveRental(organizationId: string, bookings: number, vehicles: number, form: FormData) {
  "use server";
  let result: string;
  try {
    result = await changeRental(organizationId, form);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    result = "forbidden";
  }
  redirect(`/workspace/car-rental?${new URLSearchParams({
    result,
    bookings: String(result === "book" ? 1 : bookings),
    vehicles: String(vehicles),
  })}`);
}

function RentalPages({ kind, vehicles, bookings, more }: {
  kind: "vehicles" | "bookings"; vehicles: number; bookings: number; more: boolean;
}) {
  const current = kind === "vehicles" ? vehicles : bookings;
  const next = more && current < 10000;
  if (current === 1 && !next) return null;
  const link = (number: number) => ({ pathname: "/workspace/car-rental", query: { vehicles, bookings, [kind]: number }, hash: kind });
  return <nav aria-label={kind === "vehicles" ? "Vehicle pages" : "Booking pages"} className="pagination">
    {current > 1 && <Link href={link(current - 1)}>Previous</Link>}
    <span>Page {current}</span>
    {next && <Link href={link(current + 1)}>Next</Link>}
  </nav>;
}

export default async function CarRental({ searchParams }: {
  searchParams: Promise<{ bookings?: string; vehicles?: string; result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const bookingPage = pageNumber(params.bookings);
  const vehiclePage = pageNumber(params.vehicles);
  const { allowed, vehicles, bookings } = await readRentals(session.organizationId, bookingPage, vehiclePage);
  const canWrite = session.role !== "member";
  const save = saveRental.bind(null, session.organizationId, bookingPage, vehiclePage);
  const message = params.result && Object.hasOwn(messages, params.result) ? messages[params.result] : null;

  return <>
    <header className="page-heading"><h1>Car rental</h1></header>
    {!allowed ? <p className="notice">Your subscription does not currently include Car rental.</p> : <>
      {message && <p className="notice" role="status">{message}</p>}
      {canWrite && <>
        <section className="panel">
          <h2>Add a vehicle</h2>
          <form className="fields" action={save}>
            <input name="operation" type="hidden" value="vehicle" />
            <label>Registration<input name="registration" maxLength={24} required /></label>
            <label>Vehicle name<input name="vehicleName" maxLength={120} required /></label>
            <label>Daily rate<input name="rate" inputMode="decimal" maxLength={10} required /></label>
            <label>Currency<select name="currency">{rentalCurrencies.map((currency) =>
              <option value={currency} key={currency}>{currency}</option>,
            )}</select></label>
            <button type="submit">Add vehicle</button>
          </form>
        </section>
        <section className="panel">
          <h2>Book a vehicle</h2>
          <p>Rates are saved when you book. The return date is excluded from the quoted charge. Dates use UTC.</p>
          <form className="fields" action={save}>
            <input name="operation" type="hidden" value="book" />
            <label>Vehicle registration<input name="registration" maxLength={24} required /></label>
            <label>Renter name<input name="renterName" maxLength={120} required /></label>
            <label>Pickup date<input name="startsOn" type="date" min="2000-01-01" max="2099-12-31" required /></label>
            <label>Return date<input name="dueOn" type="date" min="2000-01-01" max="2099-12-31" required /></label>
            <button type="submit">Book vehicle</button>
          </form>
        </section>
      </>}
      <section className="panel" id="vehicles">
        <h2>Vehicles</h2>
        {vehicles.length ? <div className="table-scroll"><table aria-label="Rental vehicles">
          <thead><tr><th scope="col">Registration</th><th scope="col">Vehicle</th><th scope="col">Daily rate</th></tr></thead>
          <tbody>{vehicles.slice(0, 25).map((vehicle) => <tr key={vehicle.registration}>
            <th scope="row">{vehicle.registration}</th><td>{vehicle.display_name}</td><td>{amount(vehicle.daily_minor, vehicle.currency)}</td>
          </tr>)}</tbody>
        </table></div> : <p>No vehicles on this page.</p>}
        <RentalPages kind="vehicles" vehicles={vehiclePage} bookings={bookingPage} more={vehicles.length > 25} />
      </section>
      <section className="panel" id="bookings">
        <h2>Bookings</h2>
        {bookings.length ? <div className="table-scroll"><table aria-label="Car rental bookings">
          <thead><tr><th scope="col">Renter</th><th scope="col">Vehicle</th><th scope="col">Rental dates</th>
            <th scope="col">Quoted charge</th><th scope="col">Status</th><th scope="col">Inspection</th>
            {canWrite && <th scope="col">Actions</th>}</tr></thead>
          <tbody>{bookings.slice(0, 25).map((booking) => <tr key={booking.id}>
            <th scope="row">{booking.renter_name}</th><td>{booking.registration}</td>
            <td>{booking.starts_on} to {booking.due_on}</td>
            <td>{amount(booking.quoted_minor, booking.currency)}</td><td>{statusLabels[booking.status]}</td>
            <td>{booking.pickup_notes || booking.return_notes ? <details><summary>Inspection notes</summary>
              {booking.pickup_notes && <p>Pickup — {booking.pickup_notes}</p>}
              {booking.return_notes && <p>Return — {booking.return_notes}</p>}
            </details> : "—"}</td>
            {canWrite && <td>
              {(booking.status === "out" || (booking.status === "booked" && booking.can_pick_up)) && <form className="fields" action={save}>
                <input name="operation" type="hidden" value={booking.status === "out" ? "return" : "pickup"} />
                <input name="bookingId" type="hidden" value={booking.id} />
                <label>{booking.status === "out" ? "Return inspection" : "Pickup inspection"}
                  <textarea name="notes" rows={2} maxLength={1000} required />
                </label>
                <button type="submit">{booking.status === "out" ? "Record return" : "Record pickup"}</button>
              </form>}
              {booking.status === "booked" && <form action={save}>
                <input name="operation" type="hidden" value="cancel" />
                <input name="bookingId" type="hidden" value={booking.id} />
                <button type="submit">Cancel booking</button>
              </form>}
            </td>}
          </tr>)}</tbody>
        </table></div> : <p>No bookings on this page.</p>}
        <RentalPages kind="bookings" vehicles={vehiclePage} bookings={bookingPage} more={bookings.length > 25} />
      </section>
    </>}
  </>;
}
