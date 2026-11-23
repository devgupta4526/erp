import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { engagementKinds, engagementStatuses, readPractice } from "@/server/accounting-practice";
import { saveEngagement } from "./actions";
import { practiceFeedback } from "./feedback";

export const metadata = { title: "Accounting practice" };

export default async function Practice({ searchParams }: { searchParams: Promise<{ page?: string; show?: string; result?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const all = params.show === "all";
  const rawPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 10000 ? rawPage : 1;
  const practice = await readPractice(session.organizationId, page, !all);
  const message = practiceFeedback(params.result);
  const pageLink = (target: number) => `?page=${target}${all ? "&show=all" : ""}`;

  return <>
    <header className="page-heading"><h1>Accounting practice</h1><p>Track client engagements, deadlines and internal review.</p></header>
    {message && <p className="notice" role="status">{message}</p>}
    {!practice.allowed ? <p className="notice">Your subscription does not currently include Accounting practice.</p> : <>
      {practice.can_manage && <section className="panel">
        <h2>New engagement</h2>
        {practice.companies.length === 0 ? <p>Add a client company in <Link href="/workspace/crm">CRM</Link> to create an engagement.</p> :
          <form className="fields" action={saveEngagement.bind(null, session.organizationId, null)}>
            <input type="hidden" name="operation" value="create" />
            <label>Title<input name="title" maxLength={140} required /></label>
            <label>Client company<select name="company" required>{practice.companies.map((company) =>
              <option key={company.id} value={company.id}>{company.name}</option>,
            )}</select></label>
            <label>Assigned staff<select name="assignee" required>{practice.staff.map((person) =>
              <option key={person.id} value={person.id}>{person.name}</option>,
            )}</select></label>
            <label>Type<select name="kind">{Object.entries(engagementKinds).map(([key, label]) =>
              <option key={key} value={key}>{label}</option>,
            )}</select></label>
            <label>Deadline<input type="date" name="deadline" min="1900-01-01" max="9999-12-31" required /></label>
            <button type="submit">Create engagement</button>
          </form>}
      </section>}
      <section className="panel">
        <h2>Engagement register</h2>
        <Link href={all ? "/workspace/accounting-practice" : "?show=all"}>{all ? "Hide closed engagements" : "Include closed engagements"}</Link>
        {practice.engagements.length ? <div className="table-scroll"><table aria-label="Engagement register">
          <thead><tr><th scope="col">Engagement</th><th scope="col">Client</th><th scope="col">Staff</th>
            <th scope="col">Deadline</th><th scope="col">Status</th></tr></thead>
          <tbody>{practice.engagements.slice(0, 25).map((item) => <tr key={item.id}>
            <th scope="row"><Link href={`/workspace/accounting-practice/${item.id}`}>{item.title}</Link></th>
            <td>{item.company}</td><td>{item.assignee}</td><td><time dateTime={item.deadline}>{item.deadline}</time></td>
            <td>{engagementStatuses[item.status]}</td>
          </tr>)}</tbody>
        </table></div> : <p>No engagements match this view.</p>}
        {(page > 1 || (practice.engagements.length > 25 && page < 10000)) && <nav className="pagination" aria-label="Engagement pages">
          {page > 1 && <Link href={pageLink(page - 1)}>Previous</Link>}
          <span>Page {page}</span>
          {practice.engagements.length > 25 && page < 10000 && <Link href={pageLink(page + 1)}>Next</Link>}
        </nav>}
      </section>
    </>}
  </>;
}
