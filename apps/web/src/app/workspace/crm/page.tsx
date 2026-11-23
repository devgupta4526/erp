import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, IdentityError } from "@/server/identity";
import {
  completeTask,
  convertLead,
  createCompany,
  createLead,
  createOpportunity,
  createTask,
  crmPageSize,
  isCrmId,
  listCompanies,
  listLeads,
  listOpportunities,
  listTasks,
  moveOpportunity,
  stages,
} from "@/server/crm/pipeline";

export const metadata = { title: "CRM pipeline" };

const base = "/workspace/crm";
const lastPage = 10000;

const messages: Record<string, string> = {
  saved: "Saved.",
  invalid: "Check the name, date, or stage and try again.",
  forbidden: "You do not have permission to change this record.",
  missing: "The record is unavailable or has already changed. Review the current values and try again.",
  duplicate: "A company with that name already exists.",
  unchanged: "The record is already up to date.",
  "workspace-changed": "The active workspace changed. Open the intended workspace before editing.",
};

type Location = { company?: string; opportunity?: string; page?: number; view?: "leads" };

function location({ company, opportunity, page, view }: Location = {}, result?: string) {
  const params = new URLSearchParams();
  if (company) params.set("company", company);
  if (opportunity) params.set("opportunity", opportunity);
  if (view) params.set("view", view);
  if (page && page > 1) params.set("page", String(page));
  if (result) params.set("result", result);
  return params.size ? `${base}?${params.toString()}` : base;
}

function numberPage(raw: string) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= lastPage ? value : 1;
}

async function save(organizationId: string, form: FormData) {
  "use server";

  const company = String(form.get("company") ?? "");
  const opportunity = String(form.get("opportunity") ?? "");
  const name = String(form.get("name") ?? "");
  const page = numberPage(String(form.get("page") ?? "1"));
  const operation = form.get("action");
  let result: string;

  try {
    switch (operation) {
      case "company":
        result = await createCompany(organizationId, name);
        break;
      case "opportunity":
        result = await createOpportunity(organizationId, company, name);
        break;
      case "lead":
        result = await createLead(organizationId, company, name, String(form.get("email") ?? ""));
        break;
      case "convert":
        result = await convertLead(organizationId, company, String(form.get("lead") ?? ""), name);
        break;
      case "move":
        result = await moveOpportunity(
          organizationId, company, opportunity, String(form.get("previous") ?? ""), String(form.get("stage") ?? ""),
        );
        break;
      case "task":
        result = await createTask(organizationId, company, opportunity, name, String(form.get("dueOn") ?? ""));
        break;
      case "complete":
        result = await completeTask(organizationId, company, opportunity, String(form.get("task") ?? ""));
        break;
      default:
        result = "invalid";
    }
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    if (error.code !== "FORBIDDEN") throw error;
    redirect(location({}, "workspace-changed"));
  }

  const companyId = isCrmId(company) ? company : undefined;
  const opportunityId = companyId && isCrmId(opportunity) ? opportunity : undefined;
  const view = operation === "lead" || operation === "convert" ? "leads" : undefined;
  redirect(location({ company: companyId, opportunity: opportunityId, page, view }, result));
}

function Pagination({ scope, page, count }: { scope: Location; page: number; count: number }) {
  const more = count > crmPageSize && page < lastPage;
  if (page === 1 && !more) return null;
  return <nav className="pagination" aria-label="CRM pages">
    {page > 1 && <Link href={location({ ...scope, page: page - 1 })}>Previous</Link>}
    <span>Page {page}</span>
    {more && <Link href={location({ ...scope, page: page + 1 })}>Next</Link>}
  </nav>;
}

function Status({ result }: { result?: string }) {
  if (!result || !Object.hasOwn(messages, result)) return null;
  const success = result === "saved" || result === "unchanged";
  return <p role={success ? "status" : "alert"} className={success ? "notice" : "notice error"}>{messages[result]}</p>;
}

function NoAccess() {
  return <p className="notice">Your workspace subscription does not currently include CRM access.</p>;
}

function Fields({ company, opportunity, page }: Location) {
  return <>
    {company && <input type="hidden" name="company" value={company} />}
    {opportunity && <input type="hidden" name="opportunity" value={opportunity} />}
    {page && <input type="hidden" name="page" value={page} />}
  </>;
}

export default async function Pipeline({ searchParams }: {
  searchParams: Promise<{ company?: string; opportunity?: string; page?: string; result?: string; view?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const saveForWorkspace = save.bind(null, session.organizationId);
  const canEdit = session.role === "owner" || session.role === "admin";
  const { company, opportunity, page: rawPage, result, view } = await searchParams;
  const page = numberPage(rawPage ?? "1");
  if ((company !== undefined && !isCrmId(company)) ||
      (opportunity !== undefined && (!company || !isCrmId(opportunity))) ||
      (view !== undefined && (view !== "leads" || !company || opportunity))) notFound();

  if (company && view === "leads") {
    const listing = await listLeads(company, page);
    if (!listing.allowed) return <NoAccess />;
    if (!listing.parent) notFound();
    return <>
      <header className="page-heading">
        <Link href={location({ company })}>{listing.parent.name}</Link>
        <h1>Leads</h1>
      </header>
      <Status result={result} />
      {canEdit && <section className="panel">
        <h2>Add a lead</h2>
        <form className="fields" action={saveForWorkspace}>
          <Fields company={company} />
          <input type="hidden" name="action" value="lead" />
          <label>Full name<input name="name" maxLength={120} required /></label>
          <label>Email address<input type="email" name="email" maxLength={254} /></label>
          <button type="submit">Add lead</button>
        </form>
      </section>}
      <section className="panel">
        <h2>Company leads</h2>
        {listing.records.length === 0 && <p>No leads on this page.</p>}
        {listing.records.length > 0 && <div className="table-scroll"><table>
          <thead><tr><th scope="col">Lead</th><th scope="col">Email</th><th scope="col">Opportunity</th></tr></thead>
          <tbody>{listing.records.slice(0, crmPageSize).map((lead) => <tr key={lead.id}>
            <th scope="row">{lead.name}</th><td>{lead.email ?? "—"}</td>
            <td>{lead.opportunity_id
              ? <Link href={location({ company, opportunity: lead.opportunity_id })}>View opportunity</Link>
              : canEdit
                ? <form className="fields" action={saveForWorkspace}>
                    <Fields company={company} page={page} />
                    <input type="hidden" name="action" value="convert" />
                    <input type="hidden" name="lead" value={lead.id} />
                    <label>Opportunity name<input name="name" defaultValue={lead.name} maxLength={120} required /></label>
                    <button type="submit">Convert lead</button>
                  </form>
                : "Open"}
            </td>
          </tr>)}</tbody>
        </table></div>}
        <Pagination scope={{ company, view }} page={page} count={listing.records.length} />
      </section>
    </>;
  }

  if (company && opportunity) {
    const listing = await listTasks(company, opportunity, page);
    if (!listing.allowed) return <NoAccess />;
    if (!listing.parent) notFound();
    const current = listing.parent;
    return <>
      <header className="page-heading">
        <Link href={location({ company })}>Company opportunities</Link>
        <h1>{current.name}</h1>
        <p>{stages.find(([value]) => value === current.stage)?.[1]}</p>
        {current.contact_name && <p>Primary contact {current.contact_name}</p>}
      </header>
      <Status result={result} />
      {canEdit && <section className="panel">
        <h2>Update stage</h2>
        <form className="fields" action={saveForWorkspace}>
          <Fields company={company} opportunity={opportunity} page={page} />
          <input type="hidden" name="action" value="move" />
          <input type="hidden" name="previous" value={current.stage} />
          <label>Stage<select name="stage" defaultValue={current.stage}>
            {stages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <button type="submit">Save stage</button>
        </form>
      </section>}
      {canEdit && <section className="panel">
        <h2>Add a task</h2>
        <form className="fields" action={saveForWorkspace}>
          <Fields company={company} opportunity={opportunity} />
          <input type="hidden" name="action" value="task" />
          <label>Task name<input name="name" maxLength={120} required /></label>
          <label>Due date<input type="date" name="dueOn" min="1000-01-01" max="9999-12-31" /></label>
          <button type="submit">Add task</button>
        </form>
      </section>}
      <section className="panel">
        <h2>Tasks</h2>
        {listing.records.length === 0 && <p>No tasks on this page.</p>}
        {listing.records.length > 0 && <div className="table-scroll"><table>
          <thead><tr><th scope="col">Task</th><th scope="col">Due date</th><th scope="col">Status</th>{canEdit && <th scope="col">Action</th>}</tr></thead>
          <tbody>{listing.records.slice(0, crmPageSize).map((task) => <tr key={task.id}>
            <th scope="row">{task.name}</th><td>{task.due_on ?? "—"}</td><td>{task.completed ? "Complete" : "Open"}</td>
            {canEdit && <td>{!task.completed && <form action={saveForWorkspace}>
              <Fields company={company} opportunity={opportunity} page={page} />
              <input type="hidden" name="action" value="complete" />
              <input type="hidden" name="task" value={task.id} />
              <button type="submit" aria-label={`Complete ${task.name}`}>Mark complete</button>
            </form>}</td>}
          </tr>)}</tbody>
        </table></div>}
        <Pagination scope={{ company, opportunity }} page={page} count={listing.records.length} />
      </section>
    </>;
  }

  if (company) {
    const listing = await listOpportunities(company, page);
    if (!listing.allowed) return <NoAccess />;
    if (!listing.parent) notFound();
    return <>
      <header className="page-heading">
        <Link href={base}>Companies</Link><h1>{listing.parent.name}</h1>
        <Link href={location({ company, view: "leads" })}>Leads</Link>
      </header>
      <Status result={result} />
      {canEdit && <section className="panel">
        <h2>Add an opportunity</h2>
        <form className="fields" action={saveForWorkspace}>
          <Fields company={company} />
          <input type="hidden" name="action" value="opportunity" />
          <label>Opportunity name<input name="name" maxLength={120} required /></label>
          <button type="submit">Add opportunity</button>
        </form>
      </section>}
      <section className="panel">
        <h2>Opportunities</h2>
        {listing.records.length === 0 && <p>No opportunities on this page.</p>}
        {listing.records.length > 0 && <div className="table-scroll"><table>
          <thead><tr><th scope="col">Opportunity</th><th scope="col">Stage</th></tr></thead>
          <tbody>{listing.records.slice(0, crmPageSize).map((record) => <tr key={record.id}>
            <th scope="row"><Link href={location({ company, opportunity: record.id })}>{record.name}</Link></th>
            <td>{stages.find(([value]) => value === record.stage)?.[1]}</td>
          </tr>)}</tbody>
        </table></div>}
        <Pagination scope={{ company }} page={page} count={listing.records.length} />
      </section>
    </>;
  }

  const listing = await listCompanies(page);
  if (!listing.allowed) return <NoAccess />;
  return <>
    <header className="page-heading"><h1>CRM pipeline</h1><Link href="/workspace/contacts">Contact directory</Link></header>
    <Status result={result} />
    {canEdit && <section className="panel">
      <h2>Add a company</h2>
      <form className="fields" action={saveForWorkspace}>
        <input type="hidden" name="action" value="company" />
        <label>Company name<input name="name" maxLength={120} required /></label>
        <button type="submit">Add company</button>
      </form>
    </section>}
    <section className="panel">
      <h2>Companies</h2>
      {listing.records.length === 0 && <p>No companies on this page.</p>}
      {listing.records.length > 0 && <div className="table-scroll"><table>
        <thead><tr><th scope="col">Company</th></tr></thead>
        <tbody>{listing.records.slice(0, crmPageSize).map((record) => <tr key={record.id}>
          <th scope="row"><Link href={location({ company: record.id })}>{record.name}</Link></th>
        </tr>)}</tbody>
      </table></div>}
      <Pagination scope={{}} page={page} count={listing.records.length} />
    </section>
  </>;
}
