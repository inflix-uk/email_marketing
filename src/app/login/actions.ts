"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkCredentials, startSession } from "@/lib/auth";
import { clientIp, rateLimit, refundRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { attemptLogin } from "./throttle";

export interface LoginState {
  error?: string;
  /** Echoed back so the email field keeps its value after a failed attempt. */
  email?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().slice(0, 320);
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  const result = await attemptLogin(
    { rateLimit, refundRateLimit, resetRateLimit, checkCredentials },
    email,
    // Nobody's password is this long - don't spend time hashing it.
    password.length > 1024 ? "" : password,
    clientIp(await headers()),
  );
  if (!result.ok) return { error: result.error, email };

  await startSession(email);
  // Only allow local redirects.
  redirect(next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");
}
