import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, IdentityError } from "@/server/identity";
import { invoiceCurrencies } from "@/server/invoices";
import { readPhysiotherapy, updatePhysiotherapy } from "@/server/physiotherapy";

export const metadata = { title: "Physiotherapy" };
const root = "/workspace/physiotherapy";
const messages: Record<string, string> = {
  demo: "Sample patient loaded. Complete the demo home visit, then create its invoice.",
  saved: "Changes saved.",
  invalid: "Check the form fields and try again.",
  unavailable: "This record or action is no longer available.",
  forbidden: "Your workspace or role does not allow this action.",
  overlap: "The patient or clinician already has a session during that time.",
  "plan-open": "Complete or cancel any scheduled sessions before closing this plan.",
  "package-unavailable": "Choose a paid package with visits remaining.",
};

async function save(organizationId: string, patientId: string | null, form: FormData) {
  "use server";
  let result;
  try {
    result = await updatePhysiotherapy(organizationId, patientId, form);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    result = { status: "forbidden", patientId: null };
  }
  const query = new URLSearchParams({ result: result.status });
  if (result.patientId) query.set("patient", result.patientId);
  redirect(`${root}?${query}`);
}

function Fields({ name = "", contact = "", complaints = "", history = "", alerts = "", emergency = "" }: {
  name?: string; contact?: string; complaints?: string; history?: string; alerts?: string; emergency?: string;
}) {
  return <>
    <label>Patient name<input name="name" defaultValue={name} maxLength={120} required /></label>
    <label>Contact details<input name="contact" defaultValue={contact} maxLength={254} /></label>
    <label>Emergency contact<input name="emergency" defaultValue={emergency} maxLength={254} /></label>
    <label>Chief complaints<textarea name="complaints" defaultValue={complaints} maxLength={4000} /></label>
    <label>Medical and surgical history<textarea name="history" defaultValue={history} maxLength={4000} /></label>
    <label>Red flags and allergies<textarea name="alerts" defaultValue={alerts} maxLength={4000} /></label>
  </>;
}

export default async function Physiotherapy({ searchParams }: {
  searchParams: Promise<{ patient?: string; result?: string; q?: string; page?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "member") notFound();
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.slice(0, 120) : "";
  const selected = typeof params.patient === "string" ? params.patient : undefined;
  const requestedPage = Number(params.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 && requestedPage <= 10_000 ? requestedPage : 1;
  const { allowed, patient, patients, plans, visits, packages, exercises, prescriptions, clinicians, queue } = await readPhysiotherapy(session.organizationId, selected, search, page);
  if (!allowed) return <p className="notice">Your workspace subscription does not include Physiotherapy.</p>;
  if (selected && !patient) notFound();

  const message = params.result && Object.hasOwn(messages, params.result) ? messages[params.result] : null;
  const action = save.bind(null, session.organizationId, patient?.id ?? null);
  const activePlans = plans.filter(plan => plan.status === "active");
  const usablePackages = packages.filter(pack => pack.paid && pack.remaining > 0);
  const time = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const pageLink = (number: number) => `${root}?${new URLSearchParams({ q: search, page: String(number) })}`;

  return <>
    <header className="page-heading">
      <h1>{patient?.name ?? "Physiotherapy"}</h1>
      {patient && <p><Link href={root}>Patient directory</Link> · PHY-{patient.number}{patient.is_demo && " · Synthetic sample"}</p>}
    </header>
    {message && <p className="notice" role="status">{message}</p>}
    {!patient ? <>
      <section className="panel">
        <h2>Today’s visits (UTC)</h2>
        {queue.length ? <ul>{queue.map(visit => <li key={visit.queue_token}>
          <Link href={`${root}?patient=${visit.patient_id}`}>{visit.patient}</Link>{" · "}
          {time.format(new Date(visit.starts_at))} · {visit.clinician} · {visit.location === "home" ? "Home visit" : "Clinic session"} · Token {visit.queue_token}
          {visit.checked_in_at && " · Checked in"}
        </li>)}</ul> : <p>No visits scheduled for today.</p>}
      </section>
      <section className="panel">
        <h2>Patients</h2>
        <form className="fields" method="get">
          <label>Find a patient<input name="q" defaultValue={search} maxLength={120} /></label>
          <button type="submit">Search patients</button>
        </form>
        {patients.length ? <ul>{patients.slice(0, 25).map(item => <li key={item.id}>
          <Link href={`${root}?patient=${item.id}`}>{item.name}</Link> · PHY-{item.number}{item.is_demo && " · Sample"}
        </li>)}</ul> : <p>No patients match this view.</p>}
        {(page > 1 || patients.length > 25) && <nav className="pagination" aria-label="Patient pages">
          {page > 1 && <Link href={pageLink(page - 1)}>Previous</Link>}
          {patients.length > 25 && page < 10_000 && <Link href={pageLink(page + 1)}>Next</Link>}
        </nav>}
      </section>
      <section className="panel">
        <h2>Register a patient</h2>
        <form className="fields" action={action}>
          <input type="hidden" name="operation" value="patient-create" />
          <Fields />
          <button type="submit">Register patient</button>
        </form>
      </section>
      <section className="panel">
        <h2>Sample workflow</h2>
        <p>Load a fictional patient, rehabilitation plan, home visit, progress note, and draft invoices into this workspace.</p>
        <form action={action}><button name="operation" value="demo" type="submit">Load sample patient</button></form>
      </section>
      <section className="panel">
        <h2>Exercise library</h2>
        {exercises.length > 0 && <ul>{exercises.map(exercise => <li key={exercise.id}>{exercise.region} · {exercise.title}</li>)}</ul>}
        <form className="fields" action={action}>
          <input type="hidden" name="operation" value="exercise-create" />
          <label>Exercise name<input name="title" maxLength={120} required /></label>
          <label>Body region<input name="region" maxLength={80} required /></label>
          <label>Instructions<textarea name="instructions" maxLength={4000} required /></label>
          <label>Precautions<textarea name="precautions" maxLength={4000} /></label>
          <button type="submit">Add exercise</button>
        </form>
      </section>
    </> : <>
      <section className="panel">
        <h2>Patient details</h2>
        <form className="fields" action={action}>
          <input type="hidden" name="operation" value="patient-edit" />
          <Fields name={patient.name} contact={patient.contact} complaints={patient.complaints} history={patient.history}
            alerts={patient.alerts} emergency={patient.emergency_contact} />
          <button type="submit">Save patient details</button>
        </form>
      </section>
      <section className="panel">
        <h2>Rehabilitation plans</h2>
        {plans.map(plan => <article key={plan.id}>
          <h3>{plan.title}</h3><p>{plan.status === "active" ? "Active" : "Completed"}</p>
          <p><strong>Goals</strong> {plan.goals}</p>
          {plan.home_program && <p><strong>Home program</strong> {plan.home_program}</p>}
          {prescriptions.filter(exercise => exercise.plan_id === plan.id).map(exercise => <details key={exercise.id}>
            <summary>{exercise.title} · {exercise.sets} sets × {exercise.repetitions} reps · {exercise.hold_seconds}s hold</summary>
            <p>{exercise.instructions}</p>{exercise.precautions && <p>Precautions {exercise.precautions}</p>}
          </details>)}
          {plan.status === "active" && exercises.length > 0 && <details>
            <summary>Prescribe an exercise</summary>
            <form className="fields" action={action}>
              <input type="hidden" name="operation" value="prescribe" /><input type="hidden" name="id" value={plan.id} />
              <label>Exercise<select name="exercise" required>{exercises.map(item => <option key={item.id} value={item.id}>{item.region} · {item.title}</option>)}</select></label>
              <label>Sets<input type="number" name="sets" min="1" max="100" required /></label>
              <label>Repetitions<input type="number" name="repetitions" min="1" max="1000" required /></label>
              <label>Hold (seconds)<input type="number" name="hold" min="0" max="3600" defaultValue="0" required /></label>
              <button type="submit">Save prescribed exercise</button>
            </form>
          </details>}
          {plan.status === "active" && <form action={action}>
            <input type="hidden" name="id" value={plan.id} />
            <button name="operation" value="plan-complete" type="submit">Close plan</button>
          </form>}
        </article>)}
        <form className="fields" action={action}>
          <input type="hidden" name="operation" value="plan-create" />
          <label>Plan title<input name="title" maxLength={120} required /></label>
          <label>Rehabilitation goals<textarea name="goals" maxLength={4000} required /></label>
          <label>Home program<textarea name="program" maxLength={4000} /></label>
          <button type="submit">Add rehabilitation plan</button>
        </form>
      </section>
      <section className="panel">
        <h2>Book a session</h2>
        {activePlans.length ? <form className="fields" action={action}>
          <input type="hidden" name="operation" value="visit-book" />
          <label>Rehabilitation plan<select name="plan" required>{activePlans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></label>
          <label>Clinician<select name="clinician" defaultValue={session.userId} required>{clinicians.map(clinician => <option key={clinician.id} value={clinician.id}>{clinician.name}</option>)}</select></label>
          <label>Visit location<select name="location"><option value="clinic">In clinic</option><option value="home">Home visit</option></select></label>
          <label>Starts at (UTC)<input name="start" type="datetime-local" required /></label>
          <label>Ends at (UTC)<input name="end" type="datetime-local" required /></label>
          <label>Session fee<input name="fee" inputMode="decimal" maxLength={10} required /></label>
          <label>Consumables fee<input name="consumables" inputMode="decimal" maxLength={10} /></label>
          <label>Currency<select name="currency">{invoiceCurrencies.map(currency => <option key={currency}>{currency}</option>)}</select></label>
          <details>
            <summary>Home visit travel details</summary>
            <label>Address and landmark<textarea name="address" maxLength={500} /></label>
            <label>Travel time each way (minutes)<input name="travelMinutes" type="number" min="0" max="240" /></label>
            <label>Billable travel distance (km)<input name="distance" type="number" min="0" max="99999.99" step="0.01" /></label>
            <label>Travel rate per km<input name="travelRate" inputMode="decimal" maxLength={10} /></label>
          </details>
          <button type="submit">Book session</button>
        </form> : <p>Add an active plan before booking.</p>}
      </section>
      <section className="panel">
        <h2>Prepaid packages</h2>
        {packages.length > 0 && <ul>{packages.map(pack => <li key={pack.id}>
          {pack.sessions} sessions · {pack.remaining} remaining · {pack.paid ? (pack.remaining ? "Paid" : "Used up") : "Awaiting payment"}{" · "}
          <Link href={`/workspace/invoices/${pack.invoice_id}`}>Open package invoice</Link>
        </li>)}</ul>}
        <form className="fields" action={action}>
          <input type="hidden" name="operation" value="package-create" />
          <label>Sessions in package<input type="number" name="sessions" min="1" max="100" required /></label>
          <label>Package price<input name="fee" inputMode="decimal" maxLength={10} required /></label>
          <label>Package currency<select name="currency">{invoiceCurrencies.map(currency => <option key={currency}>{currency}</option>)}</select></label>
          <button type="submit">Create package invoice</button>
        </form>
      </section>
      <section className="panel">
        <h2>Sessions, progress and billing</h2>
        {!visits.length && <p>No sessions have been booked.</p>}
        {visits.map(visit => <article key={visit.id}>
          <h3>{visit.location === "home" ? "Home visit" : "Clinic session"} · {time.format(new Date(visit.starts_at))} UTC</h3>
          <p>{visit.title} · {visit.clinician} · {visit.status} · {new Intl.NumberFormat("en", { style: "currency", currency: visit.currency }).format((visit.fee_minor + visit.travel_minor + visit.consumables_minor) / 100)}</p>
          <p>Visit token {visit.queue_token}{visit.checked_in_at && ` · Checked in ${time.format(new Date(visit.checked_in_at))} UTC`}</p>
          {visit.home_address && <p>{visit.home_address} · {visit.travel_distance} km billed · {visit.travel_minutes} min travel each way</p>}
          {visit.progress && <p><strong>Progress note</strong> {visit.progress}</p>}
          {visit.modality && <p>Modalities recorded {visit.modality}</p>}
          {visit.patient_rating !== null && <p>Patient-reported pain {visit.patient_rating}/10</p>}
          {visit.status === "scheduled" && <>
            {!visit.checked_in_at && <form action={action}>
              <input type="hidden" name="id" value={visit.id} />
              <button name="operation" value="visit-check-in" type="submit">Check in</button>
            </form>}
            {(patient.is_demo || Date.parse(visit.starts_at) <= Date.now()) && <form className="fields" action={action}>
              <input type="hidden" name="operation" value="visit-complete" />
              <input type="hidden" name="id" value={visit.id} />
              <label>Progress note<textarea name="progress" maxLength={4000} required /></label>
              <label>Modalities used<input name="modality" maxLength={500} /></label>
              <label>Patient-reported rating (0–10)<input name="rating" type="number" min="0" max="10" /></label>
              {usablePackages.length > 0 && <label>Session billing<select name="package">
                <option value="">Pay per session</option>
                {usablePackages.map(pack => <option key={pack.id} value={pack.id}>Prepaid package · {pack.remaining} of {pack.sessions} remaining</option>)}
              </select></label>}
              <button type="submit">Complete session</button>
            </form>}
            <form action={action}>
              <input type="hidden" name="id" value={visit.id} />
              <button name="operation" value="visit-cancel" type="submit">Cancel session</button>
            </form>
          </>}
          {visit.package_id ? <p>Covered by prepaid package</p> : visit.invoice_id ? <p><Link href={`/workspace/invoices/${visit.invoice_id}`}>Open session invoice</Link> · {visit.invoice_status}</p> :
            visit.status === "completed" && <form action={action}>
              <input type="hidden" name="id" value={visit.id} />
              <button name="operation" value="invoice-draft" type="submit">Create session invoice</button>
            </form>}
        </article>)}
      </section>
    </>}
  </>;
}
