"use server";

import { redirect } from "next/navigation";
import { IdentityError } from "@/server/identity";
import { updateConstruction } from "@/server/construction";

export async function saveConstruction(organizationId: string, projectId: string | null, form: FormData) {
  let outcome: Awaited<ReturnType<typeof updateConstruction>>;
  try {
    outcome = await updateConstruction(organizationId, projectId, form);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    outcome = { result: "forbidden", projectId: null };
  }
  const path = outcome.projectId ? `/workspace/construction/${outcome.projectId}` : "/workspace/construction";
  redirect(`${path}?result=${outcome.result}`);
}
