"use server";

import { redirect } from "next/navigation";
import { IdentityError, login, register } from "@/server/identity";

export async function authenticate(mode: "login" | "register", form: FormData) {
  const input = {
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
  };

  try {
    if (mode === "register") {
      await register({
        ...input,
        name: String(form.get("name") ?? ""),
        organizationName: String(form.get("organizationName") ?? ""),
      });
    } else {
      await login(input);
    }
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    redirect(`/${mode}?error=${encodeURIComponent(error.code)}`);
  }

  redirect("/workspace");
}
