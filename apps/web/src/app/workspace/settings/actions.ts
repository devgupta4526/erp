"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IdentityError } from "@/server/identity";
import { acceptInvitation, changeMemberRole, createBranch, inviteMember, revokeInvitation, switchOrganization } from "@/server/organizations";

export type SettingsResult = { status: string; token?: string };

export async function updateSettings(organizationId: string, _: SettingsResult, form: FormData): Promise<SettingsResult> {
  try {
    switch (form.get("operation")) {
      case "switch":
        if (!(await switchOrganization(organizationId, String(form.get("organizationId") ?? "")))) {
          return { status: "forbidden" };
        }
        revalidatePath("/workspace", "layout");
        redirect("/workspace");
      case "branch": {
        const status = await createBranch(organizationId, String(form.get("name") ?? ""));
        revalidatePath("/workspace/settings");
        return { status };
      }
      case "invite":
        {
          const result = await inviteMember(organizationId, String(form.get("email") ?? ""));
          revalidatePath("/workspace/settings");
          return result;
        }
      case "revoke": {
        const status = await revokeInvitation(organizationId, String(form.get("email") ?? ""));
        revalidatePath("/workspace/settings");
        return { status };
      }
      case "role": {
        const status = await changeMemberRole(
          organizationId, String(form.get("userId") ?? ""), String(form.get("role") ?? ""),
        );
        revalidatePath("/workspace/settings");
        return { status };
      }
      case "accept": {
        const status = await acceptInvitation(organizationId, String(form.get("token") ?? ""));
        revalidatePath("/workspace/settings");
        return { status };
      }
      default:
        return { status: "invalid" };
    }
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    return { status: "forbidden" };
  }
}
