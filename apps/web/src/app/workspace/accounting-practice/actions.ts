"use server";

import { redirect } from "next/navigation";
import { IdentityError } from "@/server/identity";
import { updateEngagement } from "@/server/accounting-practice";
import { addPracticeDocument } from "@/server/accounting-practice/documents";

export async function saveEngagement(organizationId: string, id: string | null, form: FormData) {
  let result: { status: string; id: string | null };
  try {
    result = await updateEngagement(organizationId, id, form);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    result = { status: "forbidden", id: null };
  }
  const path = result.id ? `/workspace/accounting-practice/${result.id}` : "/workspace/accounting-practice";
  redirect(`${path}?result=${result.status}`);
}

export async function uploadDocument(organizationId: string, engagementId: string, form: FormData) {
  let status: string;
  try {
    status = await addPracticeDocument(organizationId, engagementId, form.get("document"));
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    status = "forbidden";
  }
  redirect(`/workspace/accounting-practice/${engagementId}?result=${status}`);
}
