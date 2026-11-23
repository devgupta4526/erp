import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { constructionCurrencies, constructionPageSize, listConstructionProjects } from "@/server/construction";
import { constructionResult } from "@/server/construction/presentation";
import { saveConstruction } from "./actions";

export const metadata = { title: "Construction estimates" };

export default async function Construction({ searchParams }: {
  searchParams: Promise<{ page?: string; result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const rawPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 10000 ? rawPage : 1;
  const { allowed, projects } = await listConstructionProjects(session.organizationId, page);
  const message = constructionResult(params.result);
  const nextPage = projects.length > constructionPageSize && page < 10000;

  return <>
    <header className="page-heading"><h1>Construction estimates</h1></header>
    {!allowed ? <p className="notice">Your subscription does not currently include construction estimates.</p> : <>
      {message && <p className="notice" role="status">{message}</p>}
      {session.role !== "member" && <section className="panel">
        <h2>Create a project</h2>
        <form className="fields" action={saveConstruction.bind(null, session.organizationId, null)}>
          <input type="hidden" name="operation" value="create" />
          <label>Project name<input name="name" maxLength={120} required /></label>
          <label>Estimate currency<select name="currency">
            {constructionCurrencies.map((currency) => <option key={currency}>{currency}</option>)}
          </select></label>
          <button type="submit">Create project</button>
        </form>
      </section>}
      <section className="panel">
        <h2>Projects</h2>
        {projects.length ? <div className="table-scroll"><table aria-label="Construction projects">
          <thead><tr><th scope="col">Project</th><th scope="col">Currency</th></tr></thead>
          <tbody>{projects.slice(0, constructionPageSize).map((project) => <tr key={project.id}>
            <th scope="row"><Link href={`/workspace/construction/${project.id}`}>{project.name}</Link></th>
            <td>{project.currency}</td>
          </tr>)}</tbody>
        </table></div> : <p>No projects on this page.</p>}
        {(page > 1 || nextPage) && <nav className="pagination" aria-label="Project pages">
          {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
          <span>Page {page}</span>
          {nextPage && <Link href={`?page=${page + 1}`}>Next</Link>}
        </nav>}
      </section>
    </>}
  </>;
}
