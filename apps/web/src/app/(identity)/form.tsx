import Link from "next/link";
import { authenticate } from "./actions";

const messages: Record<string, string> = {
  INVALID_INPUT: "Check the details and use a password of at least 15 characters.",
  INVALID_CREDENTIALS: "The email or password is incorrect.",
  EMAIL_EXISTS: "This email already has an account. Sign in to continue.",
  RATE_LIMITED: "Too many attempts. Wait a few minutes before trying again.",
};

export function IdentityForm({ mode, error }: { mode: "login" | "register"; error?: string }) {
  const creating = mode === "register";
  const title = creating ? "Create a workspace" : "Sign in";
  const message = error && Object.hasOwn(messages, error) ? messages[error] : undefined;

  return <div className="entry-form">
    <h1>{title}</h1>
    {creating && <p>Start a 30-day Starter trial for your organization.</p>}
    {message && <p className="notice error" role="alert">{message}</p>}
    <form className="fields" action={authenticate.bind(null, mode)}>
      {creating && <>
        <label>Full name<input name="name" autoComplete="name" maxLength={120} required /></label>
        <label>Organization<input name="organizationName" autoComplete="organization" maxLength={120} required /></label>
      </>}
      <label>Email address<input type="email" name="email" autoComplete="username" maxLength={254} required /></label>
      <label>Password<input type="password" name="password" autoComplete={creating ? "new-password" : "current-password"} minLength={creating ? 15 : undefined} required /></label>
      <button type="submit">{title}</button>
    </form>
    <p><Link href={creating ? "/login" : "/register"}>{creating ? "Sign in to an existing workspace" : "Create a workspace"}</Link></p>
  </div>;
}
