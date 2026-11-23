"use server";

import { redirect } from "next/navigation";
import { updateDesign } from "@/server/design";
import { IdentityError } from "@/server/identity";

export async function saveDesign(organizationId: string, projectId: string | null, form: FormData) {
  let outcome: Awaited<ReturnType<typeof updateDesign>>;
  try {
    outcome = await updateDesign(organizationId, projectId, form);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    outcome = { result: "forbidden", projectId: null };
  }
  const path = outcome.projectId ? `/workspace/design/${outcome.projectId}` : "/workspace/design";
  redirect(`${path}?result=${outcome.result}`);
}
