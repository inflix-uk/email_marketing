"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { redeemPasswordLink, startSession } from "@/lib/auth";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { clientIp, rateLimit, resetRateLimit, tooManyAttemptsMessage } from "@/lib/rate-limit";
import { loginEmailKey } from "../login/throttle";

export interface ResetPasswordState {
  error?: string;
  /** The link is used up or expired: the form is replaced by a "get a new link" message. */
  expired?: boolean;
  fieldErrors?: { password?: string[]; confirm?: string[] };
}

const schema = z
  .object({
    token: z.string(),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters`),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Passwords don't match" });

export async function setNewPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const parsed = schema.safeParse({
    token: String(formData.get("token") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const ip = clientIp(await headers());
  if (ip !== "unknown") {
    const limit = await rateLimit(`reset:ip:${ip}`, { limit: 10, windowSeconds: 15 * 60 });
    if (!limit.ok) return { error: tooManyAttemptsMessage(limit.retryAfterSeconds) };
  }

  // Single use: sets the password, clears the link and signs out every other device.
  const account = await redeemPasswordLink(parsed.data.token, parsed.data.password);
  if (!account) return { expired: true };

  await resetRateLimit(loginEmailKey(account.email)); // a lockout from earlier wrong guesses ends here
  await startSession(account.email, account.sessionVersion);
  redirect("/");
}
