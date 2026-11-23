import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getSession, IdentityError } from "@/server/identity";
import { changeSandboxSubscription, readBilling, sandboxEnabled } from "@/server/subscriptions/sandbox";
import { getSubscription } from "@/server/subscriptions";

export const metadata = { title: "Billing" };

const messages: Record<string, string> = {
  done: "Sandbox subscription updated.",
  disabled: "Sandbox billing is disabled.",
  forbidden: "Switch back to this workspace and sign in as its owner.",
  invalid: "Select a valid plan and billing cycle.",
  limit: "The selected plan cannot accommodate the current members or branches.",
};

async function changeSubscription(organizationId: string, requestId: string, form: FormData) {
  "use server";
  let result: string;
  try {
    result = await changeSandboxSubscription(organizationId, {
      requestId,
      action: String(form.get("operation") ?? ""),
      plan: String(form.get("plan") ?? ""),
      cycle: String(form.get("cycle") ?? ""),
    });
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    result = "forbidden";
  }
  redirect(`/workspace/billing?result=${result}`);
}

export default async function Billing({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/workspace");
  const [{ plans, activity }, subscription, params] = await Promise.all([
    readBilling(session.organizationId), getSubscription(session.organizationId), searchParams,
  ]);
  const message = params.result && Object.hasOwn(messages, params.result) ? messages[params.result] : undefined;
  const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

  return <>
    <header className="page-heading"><h1>Billing</h1>
      {subscription && <p>{subscription.name} · {subscription.status}{subscription.has_access ? ` · Access through ${date.format(subscription.access_until)} UTC` : ""}</p>}
    </header>
    {message && <p className="notice" role="status">{message}</p>}
    {sandboxEnabled() && <>
      <section className="panel">
        <h2>Sandbox checkout</h2>
        <p>Simulates a plan change or renewal. No money is collected.</p>
        <form className="fields" action={changeSubscription.bind(null, session.organizationId, randomUUID())}>
          <label>Plan<select name="plan" required>{plans.map((plan) =>
            <option key={plan.code} value={plan.code}>{plan.name} ({plan.seat_limit ?? "unlimited"} seats, {plan.branch_limit ?? "unlimited"} branches)</option>,
          )}</select></label>
          <label>Billing cycle<select name="cycle"><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
          <button type="submit" name="operation" value="checkout">Simulate checkout</button>
        </form>
      </section>
      {subscription?.has_access && <section className="panel">
        <h2>Cancel sandbox subscription</h2>
        <p>Cancellation ends module access immediately.</p>
        <form action={changeSubscription.bind(null, session.organizationId, randomUUID())}>
          <button type="submit" name="operation" value="cancel">End access now</button>
        </form>
      </section>}
    </>}
    <section className="panel">
      <h2>Sandbox activity</h2>
      {activity.length ? <ul>{activity.map((entry) => <li key={entry.request_id}>
        {date.format(entry.created_at)} UTC · {entry.action === "sandbox_cancel" ? "Canceled" : "Checkout"} · {entry.plan}{entry.cycle ? ` (${entry.cycle})` : ""}
      </li>)}</ul> : <p>No sandbox activity yet.</p>}
    </section>
  </>;
}
