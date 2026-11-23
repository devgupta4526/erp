import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, logout } from "@/server/identity";
import { listEnabledModules } from "@/server/subscriptions";

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const modules = await listEnabledModules(session.organizationId, session.userId);

  return <div className="workspace">
    <a className="skip-link" href="#workspace-content">Skip to content</a>
    <aside className="sidebar">
      <Link className="brand" href="/workspace"><span aria-hidden="true">B</span>BusinessOS</Link>
      <div className="organization">{session.organizationName}</div>
      <nav aria-label="Workspace">
        <Link href="/workspace">Overview</Link>
        {modules.has("crm") && <Link href="/workspace/contacts">Contacts</Link>}
        {modules.has("crm") && <Link href="/workspace/crm">CRM pipeline</Link>}
        {modules.has("gym") && <Link href="/workspace/gym">Gym</Link>}
        {modules.has("hotel") && <Link href="/workspace/hotel">Hotel</Link>}
        {modules.has("car-rental") && <Link href="/workspace/car-rental">Car rental</Link>}
        {modules.has("fleet") && <Link href="/workspace/fleet">Fleet dispatch</Link>}
        {modules.has("driver-navigation") && <Link href="/workspace/driver">Driver workspace</Link>}
        {modules.has("events") && <Link href="/workspace/events">Events</Link>}
        {modules.has("construction") && <Link href="/workspace/construction">Construction</Link>}
        {modules.has("accounting-practice") && <Link href="/workspace/accounting-practice">Accounting practice</Link>}
        {modules.has("inventory") && <Link href="/workspace/inventory">Inventory</Link>}
        {modules.has("scheduling") && <Link href="/workspace/schedule">Schedule</Link>}
        {modules.has("invoices") && <Link href="/workspace/invoices">Sales invoices</Link>}
        {modules.has("courier") && <Link href="/workspace/courier">Courier</Link>}
        {modules.has("lms") && <Link href="/workspace/lms">Learning</Link>}
        {modules.has("coaching") && session.role !== "member" && <Link href="/workspace/coaching">Coaching</Link>}
        {modules.has("design") && <Link href="/workspace/design">Design</Link>}
        {session.role === "owner" && <Link href="/workspace/billing">Billing</Link>}
        <Link href="/workspace/settings">Settings</Link>
      </nav>
      <div className="account">
        <strong>{session.name}</strong>
        <form action={signOut}><button className="secondary" type="submit">Sign out</button></form>
      </div>
    </aside>
    <main className="workspace-content" id="workspace-content">{children}</main>
  </div>;
}
