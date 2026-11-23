"use server";

import { redirect } from "next/navigation";
import { IdentityError } from "@/server/identity";
import { updateInvoice } from "@/server/invoices";

export async function saveInvoice(organizationId: string, invoiceId: string | null, form: FormData) {
  let result: { status: string; invoiceId: string | null };
  try {
    result = await updateInvoice(organizationId, invoiceId, form);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    result = { status: "forbidden", invoiceId: null };
  }
  const path = result.invoiceId ? `/workspace/invoices/${result.invoiceId}` : "/workspace/invoices";
  redirect(`${path}?result=${result.status}`);
}
