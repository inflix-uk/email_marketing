import { tooManyAttemptsMessage, type RateLimitOptions, type RateLimitResult } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/utils";

// Login throttling: at most 5 failed attempts per email and 20 per IP address
// in 15 minutes. A correct sign-in doesn't count. The logic takes its limiter
// and credential check as arguments, so it is unit-tested without a database.

export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const MAX_FAILED_PER_EMAIL = 5;
export const MAX_FAILED_PER_IP = 20;

const PER_EMAIL: RateLimitOptions = { limit: MAX_FAILED_PER_EMAIL, windowSeconds: LOGIN_WINDOW_SECONDS };
const PER_IP: RateLimitOptions = { limit: MAX_FAILED_PER_IP, windowSeconds: LOGIN_WINDOW_SECONDS };

export function loginEmailKey(email: string): string {
  return "login:email:" + normalizeEmail(email).slice(0, 320);
}

/** Null when the address is unknown: one shared counter would let a single visitor lock everybody out. */
export function loginIpKey(ip: string): string | null {
  return ip && ip !== "unknown" ? "login:ip:" + ip : null;
}

export interface LoginDeps {
  rateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult>;
  refundRateLimit(key: string): Promise<void>;
  resetRateLimit(key: string): Promise<void>;
  checkCredentials(email: string, password: string): Promise<boolean>;
}

export type LoginResult = { ok: true } | { ok: false; error: string };

export const WRONG_CREDENTIALS = "Incorrect email or password.";

/**
 * Every attempt is counted before the password is checked (so parallel
 * guesses can't slip past the limit); a correct one is then taken back.
 * Once a limit is reached the password isn't checked at all.
 */
export async function attemptLogin(deps: LoginDeps, email: string, password: string, ip: string): Promise<LoginResult> {
  const ipKey = loginIpKey(ip);
  const emailKey = loginEmailKey(email);

  if (ipKey) {
    const byIp = await deps.rateLimit(ipKey, PER_IP);
    if (!byIp.ok) return { ok: false, error: tooManyAttemptsMessage(byIp.retryAfterSeconds) };
  }
  const byEmail = await deps.rateLimit(emailKey, PER_EMAIL);
  if (!byEmail.ok) return { ok: false, error: tooManyAttemptsMessage(byEmail.retryAfterSeconds) };

  if (!(await deps.checkCredentials(email, password))) return { ok: false, error: WRONG_CREDENTIALS };

  // Signed in: this attempt doesn't count, and earlier typos for this account are forgiven.
  await Promise.all([deps.resetRateLimit(emailKey), ipKey ? deps.refundRateLimit(ipKey) : null]);
  return { ok: true };
}
