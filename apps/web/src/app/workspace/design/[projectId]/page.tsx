import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/identity";
import { readDesignProject, type DesignLayer, type DesignProject } from "@/server/design";
import { saveDesign } from "../actions";
import { designStatus } from "../status";
import { DesignPreview } from "./preview";

function LayerFields({ project, kind, layer }: {
  project: DesignProject;
  kind: DesignLayer["kind"];
  layer?: DesignLayer;
}) {
  return <>
    <label>Left offset (px)<input name="x" type="number" min="0" max={project.width - 1} step="1" defaultValue={layer?.x ?? 0} required /></label>
    <label>Top offset (px)<input name="y" type="number" min="0" max={project.height - 1} step="1" defaultValue={layer?.y ?? 0} required /></label>
    <label>Width (px)<input name="width" type="number" min="1" max={project.width} step="1" defaultValue={layer?.width ?? Math.round(project.width / 2)} required /></label>
    <label>Height (px)<input name="height" type="number" min="1" max={project.height} step="1" defaultValue={layer?.height ?? Math.round(project.height / 2)} required /></label>
    <label>{kind === "text" ? "Text color" : "Fill color"}<input name="color" type="color" defaultValue={layer?.color ?? (kind === "text" ? "#17254b" : "#344ec0")} /></label>
    {kind === "text" && <>
      <label>Text<input name="content" maxLength={240} defaultValue={layer?.content ?? ""} required /></label>
      <label>Font size (px)<input name="fontSize" type="number" min="8" max="200" step="1" defaultValue={layer?.font_size ?? 24} required /></label>
    </>}
  </>;
}

function UpdateLayerFields({ layer }: { layer: DesignLayer }) {
  return <>
    <input type="hidden" name="layerId" value={layer.id} />
    <input type="hidden" name="revision" value={layer.revision} />
  </>;
}

export default async function DesignEditor({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  const project = await readDesignProject(session.organizationId, projectId);
  if (!project) notFound();
  const result = designStatus((await searchParams).result);
  const canWrite = session.role !== "member";
  const save = saveDesign.bind(null, session.organizationId, project.id);

  return <>
    <header className="page-heading">
      <Link href="/workspace/design">Design studio</Link>
      <h1>{project.name}</h1>
      <p>{project.width} × {project.height} px</p>
    </header>
    {result && <p className="notice" role="status">{result}</p>}
    <DesignPreview project={project} />
    <section className="panel">
      <h2>Layers</h2>
      <p>Layers are listed from back to front.</p>
      {!project.layers.length && <p>No layers in this design.</p>}
      {project.layers.length > 0 && <ol>
        {project.layers.map((layer, index) => <li key={layer.id}>
          {canWrite ? <details>
            <summary>{layer.kind === "text" ? layer.content : `Rectangle ${index + 1}`}</summary>
            <form className="fields" action={save} key={layer.revision}>
              <input type="hidden" name="operation" value="edit" />
              <UpdateLayerFields layer={layer} />
              <LayerFields project={project} kind={layer.kind} layer={layer} />
              <button type="submit">Save layer</button>
            </form>
            <form className="fields" action={save}>
              <UpdateLayerFields layer={layer} />
              {index > 0 && <button name="operation" value="backward" type="submit">Send backward</button>}
              {index + 1 < project.layers.length && <button name="operation" value="forward" type="submit">Bring forward</button>}
              <button name="operation" value="remove" type="submit">Remove layer</button>
            </form>
          </details> : (layer.kind === "text" ? layer.content : `Rectangle ${index + 1}`)}
        </li>)}
      </ol>}
    </section>
    {canWrite && <section className="panel">
      <h2>Add a layer</h2>
      {(["rectangle", "text"] as const).map((kind) => <details key={kind}>
        <summary>{kind === "rectangle" ? "Rectangle" : "Text"}</summary>
        <form className="fields" action={save}>
          <input type="hidden" name="operation" value="add" />
          <input type="hidden" name="kind" value={kind} />
          <LayerFields project={project} kind={kind} />
          <button type="submit">{kind === "rectangle" ? "Add rectangle" : "Add text"}</button>
        </form>
      </details>)}
    </section>}
  </>;
}
