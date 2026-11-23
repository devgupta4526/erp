import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { engagementKinds, engagementStatuses, readEngagement } from "@/server/accounting-practice";
import { saveEngagement, uploadDocument } from "../actions";
import { practiceFeedback } from "../feedback";

export default async function Engagement({ params, searchParams }: {
  params: Promise<{ engagementId: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { engagementId } = await params;
  const engagement = await readEngagement(session.organizationId, engagementId);
  if (!engagement) notFound();
  const message = practiceFeedback((await searchParams).result);
  const save = saveEngagement.bind(null, session.organizationId, engagement.id);
  const allComplete = engagement.tasks.every((task) => task.completed);

  return <>
    <header className="page-heading">
      <Link href="/workspace/accounting-practice">Accounting practice</Link>
      <h1>{engagement.title}</h1>
      <p>{engagement.company} · {engagementKinds[engagement.kind]}</p>
    </header>
    {message && <p className="notice" role="status">{message}</p>}
    <section className="panel">
      <h2>Engagement details</h2>
      <dl className="details">
        <div><dt>Status</dt><dd>{engagementStatuses[engagement.status]}</dd></div>
        <div><dt>Assigned staff</dt><dd>{engagement.assignee}</dd></div>
        <div><dt>Deadline</dt><dd><time dateTime={engagement.deadline}>{engagement.deadline}</time></dd></div>
        {engagement.approver && <div><dt>Approved by</dt><dd>{engagement.approver}</dd></div>}
        {engagement.completion_reference && <div><dt>Completion reference</dt><dd>{engagement.completion_reference}</dd></div>}
      </dl>
    </section>
    <section className="panel">
      <h2>Supporting documents</h2>
      {engagement.documents.length ? <ul>{engagement.documents.map((document) => <li key={document.id}>
        <a href={`/workspace/accounting-practice/${engagement.id}/documents/${document.id}`}>{document.name}</a>
        {" "}({Math.ceil(document.bytes / 1024)} KB)
      </li>)}</ul> : <p>No supporting documents.</p>}
      {engagement.status === "open" && <form className="fields" action={uploadDocument.bind(null, session.organizationId, engagement.id)}>
        <label>PDF or text file (up to 512 KB)<input type="file" name="document" accept=".pdf,.txt" required /></label>
        <button type="submit">Add document</button>
      </form>}
    </section>
    <section className="panel">
      <h2>Tasks</h2>
      {engagement.tasks.length ? <div className="table-scroll"><table aria-label="Engagement tasks">
        <thead><tr><th scope="col">Task</th><th scope="col">Due date</th><th scope="col">Status</th>
          {engagement.status === "open" && <th scope="col">Actions</th>}</tr></thead>
        <tbody>{engagement.tasks.map((task) => <tr key={task.id}>
          <th scope="row">{task.title}</th><td><time dateTime={task.due_on}>{task.due_on}</time></td>
          <td>{task.completed ? "Complete" : "Open"}</td>
          {engagement.status === "open" && <td>{!task.completed && <form action={save}>
            <input type="hidden" name="operation" value="complete-task" />
            <input type="hidden" name="task" value={task.id} />
            <button type="submit">Mark complete</button>
          </form>}</td>}
        </tr>)}</tbody>
      </table></div> : <p>No tasks assigned.</p>}
      {engagement.can_manage && engagement.status === "open" && <form className="fields" action={save}>
        <input type="hidden" name="operation" value="add-task" />
        <label>Task title<input name="title" maxLength={140} required /></label>
        <label>Due date<input type="date" name="due" min="1900-01-01" max={engagement.deadline} required /></label>
        <button type="submit">Add task</button>
      </form>}
    </section>
    {engagement.status === "open" && <section className="panel">
      <h2>Submit for review</h2>
      <p>{allComplete ? "The reviewer must be an owner or admin other than the assigned staff member." : "Complete the outstanding tasks to submit this engagement."}</p>
      {allComplete && <form action={save}>
        <input type="hidden" name="operation" value="submit" />
        <button type="submit">Submit for review</button>
      </form>}
    </section>}
    {engagement.can_manage && engagement.status === "review" && <section className="panel">
      <h2>Review</h2>
      <form className="fields" action={save}>
        <button type="submit" name="operation" value="approve">Approve</button>
        <button type="submit" name="operation" value="return">Return to open</button>
      </form>
    </section>}
    {engagement.can_manage && engagement.status === "approved" && <section className="panel">
      <h2>Close engagement</h2>
      <form className="fields" action={save}>
        <input type="hidden" name="operation" value="close" />
        <label>Completion reference<input name="reference" maxLength={120} required /></label>
        <button type="submit">Record completion</button>
      </form>
    </section>}
  </>;
}
