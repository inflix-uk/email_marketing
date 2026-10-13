"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { sendPasswordResetIfAccountExists } from "@/lib/auth";
import { clientIp, rateLimit, tooManyAttemptsMessage } from "@/lib/rate-limit";
import { isValidEmail, normalizeEmail } from "@/lib/utils";

export interface ForgotPasswordState {
  /** True once the request was accepted - shown the same whether or not the account exists. */
  sent?: boolean;
  error?: string;
  fieldErrors?: { email?: string[] };
}

const WINDOW_SECONDS = 15 * 60;
const MAX_PER_EMAIL = 3;
const MAX_PER_IP = 10;

export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = normalizeEmail(String(formData.get("email") ?? "")).slice(0, 320);
  if (!isValidEmail(email)) return { fieldErrors: { email: ["Enter a valid email address"] } };

  // Counted per typed email and per visitor, whether or not the account
  // exists - so the limit itself gives nothing away.
  const ip = clientIp(await headers());
  const [byIp, byEmail] = await Promise.all([
    ip === "unknown" ? null : rateLimit(`forgot:ip:${ip}`, { limit: MAX_PER_IP, windowSeconds: WINDOW_SECONDS }),
    rateLimit(`forgot:email:${email}`, { limit: MAX_PER_EMAIL, windowSeconds: WINDOW_SECONDS }),
  ]);
  const retryAfter = Math.max(byIp?.ok === false ? byIp.retryAfterSeconds : 0, byEmail.ok ? 0 : byEmail.retryAfterSeconds);
  if (retryAfter > 0) return { error: tooManyAttemptsMessage(retryAfter) };

  // After the response, so the answer takes equally long for known and unknown emails.
  after(async () => {
    try {
      await sendPasswordResetIfAccountExists(email);
    } catch (err) {
      console.error("[forgot-password] could not send the reset email:", err instanceof Error ? err.message : err);
    }
  });
  return { sent: true };
}
