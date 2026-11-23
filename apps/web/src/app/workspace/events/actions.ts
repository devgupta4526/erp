"use server";

import { redirect } from "next/navigation";
import { IdentityError } from "@/server/identity";
import { updateEvents } from "@/server/events";

export async function saveEvent(organizationId: string, eventId: string | null, page: number, form: FormData) {
  let result: { status: string; eventId?: string | null };
  try {
    result = await updateEvents(organizationId, eventId, form);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    result = { status: "forbidden" };
  }
  const id = result.eventId ?? eventId;
  const target = id ? `/workspace/events/${id}` : "/workspace/events";
  redirect(`${target}?${new URLSearchParams({ result: result.status, page: String(page) })}`);
}
