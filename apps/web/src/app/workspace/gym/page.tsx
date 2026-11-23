import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { readRoster, updateRoster } from "@/server/gym";
import { archiveGymPlan, createGymPlan, currencies, paymentMethods, readGymBilling, recordGymPayment } from "@/server/gym/billing";

export const metadata = { title: "Gym" };

const feedback: Record<string, string> = {
  register: "Member registered.",
  "plan-created": "Membership plan added.",
  "plan-archived": "Membership plan archived.",
  "payment-recorded": "Payment and membership saved.",
  "duplicate-plan": "An active plan already uses that name.",
  "duplicate-reference": "That receipt reference has already been recorded.",
  "invalid-plan": "Check the plan details and choose an active plan.",
  "invalid-payment": "Choose a member, a plan, a payment method and a receipt reference.",
  "workspace-changed": "Your active workspace changed. Review the workspace before submitting again.",
  attend: "Attendance recorded for today.",
  "already-attended": "Attendance has already been recorded today.",
  inactive: "An active membership is required to record attendance.",
  forbidden: "You do not have permission to update this roster.",
  invalid: "Check the member details and try again.",
};

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount / 100);
}

async function changeRoster(organizationId: string, form: FormData) {
  "use server";
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.organizationId !== organizationId) redirect("/workspace/gym?result=workspace-changed");
  const kind = form.get("kind");
  const field = (name: string) => String(form.get(name) ?? "");
  const memberId = field("memberId");
  let result = "invalid";
  if (kind === "register") result = await updateRoster(organizationId, { kind, name: field("name") });
  if (kind === "attend") result = await updateRoster(organizationId, { kind, memberId });
  if (kind === "create-plan") result = await createGymPlan(organizationId, {
    name: field("name"), days: field("days"), amount: field("amount"), currency: field("currency"),
  });
  if (kind === "archive-plan") result = await archiveGymPlan(organizationId, field("planId"));
  if (kind === "payment") result = await recordGymPayment(organizationId, {
    memberId, planId: field("planId"), method: field("method"), reference: field("reference"),
  });
  const page = Number(form.get("page"));
  const nextPage = kind !== "register" && Number.isSafeInteger(page) && page > 0 && page <= 10000 ? page : 1;
  redirect(`/workspace/gym?page=${nextPage}&result=${result}`);
}

export default async function Gym({ searchParams }: { searchParams: Promise<{ page?: string; result?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const rawPage = Number(params.page ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 10000 ? rawPage : 1;
  const { allowed, members } = await readRoster(page);
  const { plans, attendance, receipts } = await readGymBilling();
  const mutate = changeRoster.bind(null, session.organizationId);
  const canEdit = session.role !== "member";
  const message = params.result && Object.hasOwn(feedback, params.result) ? feedback[params.result] : undefined;

  return <>
    <header className="page-heading"><h1>Gym</h1><p>Memberships and attendance use UTC dates.</p></header>
    {!allowed ? <p className="notice">Your workspace subscription does not currently include access to Gym.</p> : <>
      {message && <p className="notice" role="status">{message}</p>}
      {canEdit && <section className="panel">
        <h2>Register a member</h2>
        <form className="fields" action={mutate}>
          <input type="hidden" name="kind" value="register" />
          <label>Full name<input name="name" maxLength={120} required /></label>
          <button type="submit">Register member</button>
        </form>
      </section>}
      <section className="panel">
        <h2>Membership plans</h2>
        {canEdit && <form className="fields contact-form" action={mutate}>
          <input type="hidden" name="kind" value="create-plan" />
          <label>Name<input name="name" maxLength={120} required /></label>
          <label>Term in days<input type="number" name="days" min={1} max={3650} required /></label>
          <label>Price<input name="amount" inputMode="decimal" placeholder="0.00" maxLength={10} required /></label>
          <label>Currency<select name="currency">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          <button type="submit">Add plan</button>
        </form>}
        {plans.length ? <div className="table-scroll"><table aria-label="Active membership plans">
          <thead><tr><th scope="col">Name</th><th scope="col">Term</th><th scope="col">Price</th>{canEdit && <th scope="col">Action</th>}</tr></thead>
          <tbody>{plans.map((plan) => <tr key={plan.id}>
            <th scope="row">{plan.name}</th><td>{plan.term_days} days</td><td>{formatPrice(plan.price_minor, plan.currency)}</td>
            {canEdit && <td><form action={mutate}>
              <input type="hidden" name="planId" value={plan.id} />
              <button type="submit" name="kind" value="archive-plan" aria-label={`Archive ${plan.name}`}>Archive</button>
            </form></td>}
          </tr>)}</tbody>
        </table></div> : <p>No active plans.</p>}
      </section>
      <section className="panel">
        <h2>Member roster</h2>
        {members.length ? <div className="table-scroll"><table aria-label="Gym member roster">
          <thead><tr><th scope="col">Member</th><th scope="col">Membership</th><th scope="col">Today’s attendance</th>{canEdit && <th scope="col">Action</th>}</tr></thead>
          <tbody>{members.slice(0, 25).map((member) => <tr key={member.id}>
            <th scope="row">{member.name}</th>
            <td>{member.active ? "Active" : "Inactive"}</td>
            <td>{member.attended ? "Recorded" : "—"}</td>
            {canEdit && <td>
              {member.active && !member.attended && <form action={mutate}>
                <input type="hidden" name="memberId" value={member.id} />
                <input type="hidden" name="page" value={page} />
                <button type="submit" name="kind" value="attend">Record attendance</button>
              </form>}
              {plans.length > 0 && <details>
                <summary>{member.active ? "Renew membership" : "Activate membership"}</summary>
                <form className="fields" action={mutate}>
                  <input type="hidden" name="kind" value="payment" />
                  <input type="hidden" name="memberId" value={member.id} />
                  <input type="hidden" name="page" value={page} />
                  <label>Plan<select name="planId" required>
                    {plans.map((plan) => <option key={plan.id} value={plan.id}>
                      {plan.name} ({formatPrice(plan.price_minor, plan.currency)})
                    </option>)}
                  </select></label>
                  <label>Payment method<select name="method">
                    {Object.entries(paymentMethods).map(([method, label]) => <option key={method} value={method}>{label}</option>)}
                  </select></label>
                  <label>Receipt reference<input name="reference" maxLength={120} required /></label>
                  <button type="submit">Record received payment</button>
                </form>
              </details>}
            </td>}
          </tr>)}</tbody>
        </table></div> : <p>{page === 1 ? "No members yet." : "No members on this page."}</p>}
        {(page > 1 || (members.length > 25 && page < 10000)) && <nav className="pagination" aria-label="Roster pages">
          {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
          <span>Page {page}</span>
          {members.length > 25 && page < 10000 && <Link href={`?page=${page + 1}`}>Next</Link>}
        </nav>}
      </section>
      <section className="panel">
        <h2>Attendance in the last 30 days</h2>
        {attendance.length ? <div className="table-scroll"><table aria-label="Daily attendance">
          <thead><tr><th scope="col">UTC date</th><th scope="col">Check-ins</th></tr></thead>
          <tbody>{attendance.map((day) => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.visits}</td></tr>)}</tbody>
        </table></div> : <p>No check-ins during this period.</p>}
      </section>
      {canEdit && <section className="panel">
        <h2>Recent membership payments</h2>
        {receipts.length ? <div className="table-scroll"><table aria-label="Recent membership payments">
          <thead><tr><th scope="col">Receipt</th><th scope="col">Member</th><th scope="col">UTC date</th><th scope="col">Amount</th></tr></thead>
          <tbody>{receipts.map((receipt) => <tr key={receipt.id}>
            <th scope="row">{receipt.reference}</th><td>{receipt.name}</td><td>{receipt.date}</td>
            <td>{formatPrice(receipt.amount_minor, receipt.currency)}</td>
          </tr>)}</tbody>
        </table></div> : <p>No membership payments recorded.</p>}
      </section>}
    </>}
  </>;
}
