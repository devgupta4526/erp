import { IdentityForm } from "../form";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return <IdentityForm mode="login" error={(await searchParams).error} />;
}
