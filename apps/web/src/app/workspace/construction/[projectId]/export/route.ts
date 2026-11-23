import { IdentityError } from "@/server/identity";
import { readConstructionEstimate } from "@/server/construction";
import { estimateAmount } from "@/server/construction/presentation";

export const dynamic = "force-dynamic";

function csvCell(input: string) {
  const safe = /^\s*[=+\-@]/u.test(input.normalize("NFKC")) ? `'${input}` : input;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const workspace = new URL(request.url).searchParams.get("workspace");
  const { projectId } = await params;
  if (!workspace) return new Response(null, { status: 404 });
  let estimate: Awaited<ReturnType<typeof readConstructionEstimate>>;
  try {
    estimate = await readConstructionEstimate(workspace, projectId);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    return new Response(null, { status: error.code === "UNAUTHENTICATED" ? 401 : 404 });
  }
  if (!estimate) return new Response(null, { status: 404 });
  const rows = [
    ["Project", "Description", "Quantity", "Unit", "Currency", "Unit rate", "Line total"],
    ...estimate.lines.map((line) => [estimate.project.name, line.description, line.quantity, line.unit,
      estimate.project.currency, estimateAmount(line.rate), estimateAmount(line.total)]),
    [estimate.project.name, "Estimate total", "", "", estimate.project.currency, "", estimateAmount(estimate.total)],
  ];
  return new Response(`${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="construction-estimate-${estimate.project.id}.csv"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
