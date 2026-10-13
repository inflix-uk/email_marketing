"use server";

import { redirect } from "next/navigation";
import { checkCredentials, startSession } from "@/lib/auth";

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!(await checkCredentials(email, password))) {
    return { error: "Incorrect email or password." };
  }
  await startSession(email);
  // Only allow local redirects.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
