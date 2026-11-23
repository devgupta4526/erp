import { getSession, IdentityError } from "@/server/identity";
import { fetchPracticeDocument } from "@/server/accounting-practice/documents";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ engagementId: string; documentId: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const missing = () => new Response("Document unavailable", { status: 404, headers });
  const session = await getSession();
  if (!session) return missing();
  const { engagementId, documentId } = await context.params;
  try {
    const document = await fetchPracticeDocument(session.organizationId, engagementId, documentId);
    if (!document) return missing();
    const extension = document.media_type === "application/pdf" ? "pdf" : "txt";
    const encodedName = encodeURIComponent(document.name).replace(/[!'()*]/g, (value) =>
      `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new Response(Uint8Array.from(document.content), {
      headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="document.${extension}"; filename*=UTF-8''${encodedName}`,
        "Content-Length": String(document.content.length),
      },
    });
  } catch (error) {
    if (error instanceof IdentityError) return missing();
    throw error;
  }
}
