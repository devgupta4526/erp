import Link from "next/link";
import { redirect } from "next/navigation";
import { designPageSize, listDesignProjects } from "@/server/design";
import { getSession } from "@/server/identity";
import { saveDesign } from "./actions";
import { designStatus } from "./status";

export const metadata = { title: "Design studio" };

export default async function DesignStudio({ searchParams }: {
  searchParams: Promise<{ page?: string; result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const rawPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 10000 ? rawPage : 1;
  const { allowed, projects } = await listDesignProjects(session.organizationId, page);
  const message = designStatus(params.result);
  const nextPage = projects.length > designPageSize && page < 10000;
  return <>
    <header className="page-heading"><h1>Design studio</h1></header>
    {!allowed ? <p className="notice">Your subscription does not currently include the design studio.</p> : <>
      {message && <p className="notice" role="status">{message}</p>}
      {session.role !== "member" && <section className="panel">
        <h2>Create a design</h2>
        <form className="fields" action={saveDesign.bind(null, session.organizationId, null)}>
          <input type="hidden" name="operation" value="create" />
          <label>Design name<input name="name" maxLength={120} required /></label>
          <label>Width (px)<input name="width" type="number" min="64" max="2048" step="1" defaultValue="1080" required /></label>
          <label>Height (px)<input name="height" type="number" min="64" max="2048" step="1" defaultValue="1080" required /></label>
          <label>Background color<input name="background" type="color" defaultValue="#f5f6fa" /></label>
          <button type="submit">Create design</button>
        </form>
      </section>}
      <section className="panel">
        <h2>Projects</h2>
        {projects.length ? <div className="table-scroll"><table aria-label="Design projects">
          <thead><tr><th scope="col">Project</th><th scope="col">Dimensions (px)</th></tr></thead>
          <tbody>{projects.slice(0, designPageSize).map((project) => <tr key={project.id}>
            <th scope="row"><Link href={`/workspace/design/${project.id}`}>{project.name}</Link></th>
            <td>{project.width} × {project.height}</td>
          </tr>)}</tbody>
        </table></div> : <p>No designs on this page.</p>}
        {(page > 1 || nextPage) && <nav className="pagination" aria-label="Design pages">
          {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
          <span>Page {page}</span>
          {nextPage && <Link href={`?page=${page + 1}`}>Next</Link>}
        </nav>}
      </section>
    </>}
  </>;
}
