import { redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { getSubscription } from "@/server/subscriptions";

export const metadata = { title: "Overview" };

export default async function Workspace() {
  const session = await getSession();
  if (!session) redirect("/login");
  const subscription = await getSubscription(session.organizationId);

  return <>
    <header className="page-heading"><h1>{session.organizationName}</h1><p>Workspace overview</p></header>
    <section className="panel">
      <h2>Subscription</h2>
      {subscription ? <dl className="details">
        <div><dt>Plan</dt><dd>{subscription.name}</dd></div>
        <div><dt>Status</dt><dd>{subscription.has_access ? (subscription.status === "trialing" ? "Trial active" : "Active") : "Access inactive"}</dd></div>
        <div><dt>Access through</dt><dd>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(subscription.access_until)} UTC</dd></div>
      </dl> : <p>No subscription is assigned.</p>}
    </section>
  </>;
}
