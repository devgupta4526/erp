import { IdentityForm } from "../form";

export const metadata = { title: "Create a workspace" };

export default async function Register({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return <IdentityForm mode="register" error={(await searchParams).error} />;
}
