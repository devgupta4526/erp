import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/server/identity";

export default async function IdentityLayout({ children }: { children: ReactNode }) {
  if (await getSession()) redirect("/workspace");

  return <main className="entry">
    <aside className="entry-brand"><div className="brand"><span aria-hidden="true">B</span>BusinessOS</div></aside>
    <section className="entry-content">{children}</section>
  </main>;
}
