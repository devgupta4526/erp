import { redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { readAdministration, readOrganizations } from "@/server/organizations";
import { SettingsForm } from "./form";

export const metadata = { title: "Workspace settings" };

export default async function Settings() {
  const session = await getSession();
  if (!session) redirect("/login");
  const organizations = await readOrganizations();
  const administration = session.role === "member" ? null : await readAdministration(session.organizationId);
  const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return <>
    <header className="page-heading"><h1>Workspace settings</h1></header>
    {organizations.length > 1 && <section className="panel">
      <h2>Switch workspace</h2>
      <SettingsForm organizationId={session.organizationId} operation="switch" submit="Switch workspace">
        <label>Workspace<select name="organizationId" defaultValue={session.organizationId}>
          {organizations.map((org) => <option key={org.id} value={org.id}>{org.name} ({org.role})</option>)}
        </select></label>
      </SettingsForm>
    </section>}
    <section className="panel">
      <h2>Join a workspace</h2>
      <SettingsForm organizationId={session.organizationId} operation="accept" submit="Join workspace">
        <label>Invitation code<input name="token" autoComplete="off" maxLength={32} required /></label>
      </SettingsForm>
    </section>
    {administration && <>
      <section className="panel">
        <h2>Branches</h2>
        <SettingsForm organizationId={session.organizationId} operation="branch" submit="Create branch">
          <label>Branch name<input name="name" maxLength={120} required /></label>
        </SettingsForm>
        {administration.branches.length > 0 && <ul>{administration.branches.map((branch) => <li key={branch.id}>{branch.name}</li>)}</ul>}
      </section>
      <section className="panel">
        <h2>Members</h2>
        <SettingsForm organizationId={session.organizationId} operation="invite" submit="Generate invitation">
          <label>Invitee email<input type="email" name="email" maxLength={254} required /></label>
        </SettingsForm>
        <div className="table-scroll"><table aria-label="Workspace members">
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th>
            {session.role === "owner" && <th scope="col">Change role</th>}</tr></thead>
          <tbody>{administration.members.map((member) => <tr key={member.id}>
            <th scope="row">{member.name}</th><td>{member.email}</td><td>{member.role}</td>
            {session.role === "owner" && <td>{member.role !== "owner" && <SettingsForm
              organizationId={session.organizationId} operation="role" submit="Save role">
              <input type="hidden" name="userId" value={member.id} />
              <label>Role for {member.name}<select name="role" defaultValue={member.role}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select></label>
            </SettingsForm>}</td>}
          </tr>)}</tbody>
        </table></div>
      </section>
      {administration.invitations.length > 0 && <section className="panel">
        <h2>Pending invitations</h2>
        <div className="table-scroll"><table aria-label="Pending invitations">
          <thead><tr><th scope="col">Email</th><th scope="col">Expires (UTC)</th><th scope="col">Actions</th></tr></thead>
          <tbody>{administration.invitations.map((invite) => <tr key={invite.email}>
            <th scope="row">{invite.email}</th><td>{date.format(invite.expires_at)}</td><td>
              <SettingsForm organizationId={session.organizationId} operation="revoke" submit="Revoke invitation">
                <input type="hidden" name="email" value={invite.email} />
              </SettingsForm>
            </td>
          </tr>)}</tbody>
        </table></div>
      </section>}
      <section className="panel">
        <h2>Recent activity</h2>
        <div className="table-scroll"><table aria-label="Recent workspace activity">
          <thead><tr><th scope="col">Event</th><th scope="col">Time (UTC)</th></tr></thead>
          <tbody>{administration.events.map((event) => <tr key={event.id}>
            <th scope="row">{event.action}</th><td>{date.format(event.created_at)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
    </>}
  </>;
}
