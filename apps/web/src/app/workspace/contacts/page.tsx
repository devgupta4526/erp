import Link from "next/link";
import { redirect } from "next/navigation";
import { createContact, listContacts } from "@/server/crm/contacts";
import { getSession, IdentityError } from "@/server/identity";

export const metadata = { title: "Contacts" };

async function saveContact(organizationId: string, form: FormData) {
  "use server";
  let result: string;
  try {
    result = await createContact(organizationId, {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      company: String(form.get("company") ?? ""),
    });
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    if (error.code !== "FORBIDDEN") throw error;
    result = "workspace-changed";
  }
  redirect(`/workspace/contacts?result=${result}`);
}

export default async function Contacts({ searchParams }: {
  searchParams: Promise<{ page?: string; result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const rawPage = Number(params.page ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 10000 ? rawPage : 1;
  const { allowed, contacts } = await listContacts(page);

  return <>
    <header className="page-heading"><h1>Contacts</h1><Link href="/workspace/crm">CRM pipeline</Link></header>
    {!allowed ? <p className="notice">Your workspace subscription does not currently include access to contacts.</p> : <>
      {params.result === "created" && <p role="status" className="notice">Contact added.</p>}
      {params.result === "invalid" && <p role="alert" className="notice error">Enter a name and check the email address and field lengths.</p>}
      {params.result === "forbidden" && <p role="alert" className="notice error">You do not have permission to add contacts.</p>}
      {params.result === "workspace-changed" && <p role="alert" className="notice error">The active workspace changed. Open the intended workspace before adding the contact.</p>}
      {session.role !== "member" && <section className="panel">
        <h2>Add contact</h2>
        <form className="fields contact-form" action={saveContact.bind(null, session.organizationId)}>
          <label>Name<input name="name" maxLength={120} required /></label>
          <label>Email<input name="email" type="email" maxLength={254} /></label>
          <label>Company<input name="company" maxLength={120} /></label>
          <button type="submit">Add contact</button>
        </form>
      </section>}
      <section className="panel">
        <h2>Contact directory</h2>
        {contacts.length ? <div className="table-scroll"><table aria-label="Contact directory">
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Company</th></tr></thead>
          <tbody>{contacts.slice(0, 25).map((contact) => <tr key={contact.id}>
            <th scope="row">{contact.name}</th><td>{contact.email ?? "—"}</td><td>{contact.company ?? "—"}</td>
          </tr>)}</tbody>
        </table></div> : <p>{page === 1 ? "No contacts yet." : "No contacts on this page."}</p>}
        {(page > 1 || (contacts.length > 25 && page < 10000)) && <nav className="pagination" aria-label="Contact pages">
          {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
          <span>Page {page}</span>
          {contacts.length > 25 && page < 10000 && <Link href={`?page=${page + 1}`}>Next</Link>}
        </nav>}
      </section>
    </>}
  </>;
}
