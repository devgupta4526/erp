"use client";

import { useActionState, type ReactNode } from "react";
import { updateSettings } from "./actions";

const messages: Record<string, string> = {
  branch: "Branch created.",
  duplicate: "A branch with that name already exists.",
  forbidden: "Your role or subscription does not allow this action.",
  invalid: "Check the details. Invitation codes must be current and addressed to your account email.",
  limit: "This workspace has reached its plan limit.",
  invited: "Share this one-time code with the invitee. It expires in three days.",
  joined: "Workspace joined. Select it in Switch workspace.",
  revoked: "Invitation revoked.",
  role: "Member role updated.",
};

export function SettingsForm({ organizationId, operation, submit, children }: {
  organizationId: string;
  operation: string;
  submit: string;
  children: ReactNode;
}) {
  const [result, action, pending] = useActionState(updateSettings.bind(null, organizationId), { status: "" });
  return <form className="fields" action={action}>
    <input type="hidden" name="operation" value={operation} />
    {children}
    <button type="submit" disabled={pending}>{submit}</button>
    {result.status && <p className="notice" role="status">{messages[result.status]}</p>}
    {result.token && <label>Invitation code<input readOnly value={result.token} onFocus={(event) => event.currentTarget.select()} /></label>}
  </form>;
}
