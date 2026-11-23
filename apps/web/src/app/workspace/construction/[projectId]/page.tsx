import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { readConstructionEstimate } from "@/server/construction";
import { constructionResult, estimateAmount } from "@/server/construction/presentation";
import { saveConstruction } from "../actions";

export default async function ConstructionProject({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  const estimate = await readConstructionEstimate(session.organizationId, projectId);
  if (!estimate) notFound();
  const { project, lines, total } = estimate;
  const message = constructionResult((await searchParams).result);
  const canWrite = session.role !== "member";
  const save = saveConstruction.bind(null, session.organizationId, project.id);
  const exportQuery = new URLSearchParams({ workspace: session.organizationId });

  return <>
    <header className="page-heading">
      <Link href="/workspace/construction">Construction estimates</Link>
      <h1>{project.name}</h1>
    </header>
    {message && <p className="notice" role="status">{message}</p>}
    <section className="panel">
      <h2>Bill of quantities</h2>
      <dl className="details">
        <div><dt>Estimate total</dt><dd>{project.currency} {estimateAmount(total)}</dd></div>
      </dl>
      <a href={`/workspace/construction/${project.id}/export?${exportQuery}`}>Download estimate CSV</a>
      {lines.length ? <div className="table-scroll"><table aria-label="Bill of quantities">
        <thead><tr><th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit</th>
          <th scope="col">Rate ({project.currency})</th><th scope="col">Total ({project.currency})</th>
          {canWrite && <th scope="col">Actions</th>}</tr></thead>
        <tbody>{lines.map((line) => <tr key={line.id}>
          <th scope="row">{line.description}</th><td>{line.quantity}</td><td>{line.unit}</td>
          <td>{estimateAmount(line.rate)}</td><td>{estimateAmount(line.total)}</td>
          {canWrite && <td><form action={save}>
            <input type="hidden" name="operation" value="remove" />
            <input type="hidden" name="lineId" value={line.id} />
            <button type="submit" aria-label={`Remove ${line.description}`}>Remove</button>
          </form></td>}
        </tr>)}</tbody>
      </table></div> : <p>No lines in this estimate.</p>}
      {canWrite && <form className="fields" action={save}>
        <input type="hidden" name="operation" value="line" />
        <label>Description<input name="description" maxLength={160} required /></label>
        <label>Quantity<input name="quantity" type="number" min="0.001" max="1000000" step="0.001" required /></label>
        <label>Unit<input name="unit" maxLength={20} required /></label>
        <label>Rate per unit ({project.currency})<input name="rate" type="number" min="0" max="10000000" step="0.01" required /></label>
        <button type="submit">Add estimate line</button>
      </form>}
    </section>
  </>;
}
