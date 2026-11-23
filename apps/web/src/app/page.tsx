import { redirect } from "next/navigation";
import { getSession } from "@/server/identity";

export default async function Home() {
  redirect(await getSession() ? "/workspace" : "/login");
}
