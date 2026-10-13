import { collections, isDuplicateKeyError } from "@/db";

// Fixed-window rate limiting backed by the `rateLimits` collection (one
// counter document per key, removed by a TTL index on expiresAt). The window
// starts with the first hit. Framework-agnostic: used by server actions, route
// handlers and the public API.
//
// If the database is unreachable the limiter fails open (the request is
// allowed) - a broken counter must never lock everyone out.

export interface RateLimitOptions {
  /** Hits allowed per window. */
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window ends; 0 when `ok`. */
  retryAfterSeconds: number;
}

const ALLOWED: RateLimitResult = { ok: true, retryAfterSeconds: 0 };

/** Pure: is a counter that now stands at `count` still within the limit? */
export function evaluateRateLimit(count: number, expiresAt: Date, limit: number, now: Date): RateLimitResult {
  if (count <= limit) return ALLOWED;
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)) };
}

/**
 * Count one hit for `key` and say whether it is within the limit.
 * Example: `await rateLimit("subscribe:" + ip, { limit: 10, windowSeconds: 60 })`.
 */
export async function rateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  try {
    const now = new Date();
    const { rateLimits } = await collections();
    const expiresAt = new Date(now.getTime() + opts.windowSeconds * 1000);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const doc = await rateLimits.findOneAndUpdate(
          { _id: key, expiresAt: { $gt: now } },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
          { upsert: true, returnDocument: "after" },
        );
        if (doc) return evaluateRateLimit(doc.count, doc.expiresAt, opts.limit, now);
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        // The key exists but did not match: an expired counter the TTL monitor
        // has not removed yet (it runs about once a minute), or a lost upsert
        // race. Clear the expired one and try again.
        await rateLimits.deleteOne({ _id: key, expiresAt: { $lte: now } });
      }
    }
    throw new Error("counter is busy");
  } catch (err) {
    console.error(`[rate-limit] failing open for "${key}":`, err instanceof Error ? err.message : err);
    return ALLOWED;
  }
}

/** Take back one hit (e.g. a login attempt that turned out to be correct). Never throws. */
export async function refundRateLimit(key: string): Promise<void> {
  try {
    const { rateLimits } = await collections();
    await rateLimits.updateOne({ _id: key, count: { $gt: 0 } }, { $inc: { count: -1 } });
  } catch (err) {
    console.error(`[rate-limit] could not refund "${key}":`, err instanceof Error ? err.message : err);
  }
}

/** Forget the counter for `key`. Never throws. */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    const { rateLimits } = await collections();
    await rateLimits.deleteOne({ _id: key });
  } catch (err) {
    console.error(`[rate-limit] could not reset "${key}":`, err instanceof Error ? err.message : err);
  }
}

/** Best-effort client IP from x-forwarded-for / x-real-ip; "unknown" if absent. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0];
  return normalizeIp(forwarded ?? "") || normalizeIp(headers.get("x-real-ip") ?? "") || "unknown";
}

function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip); // [2001:db8::1]:443
  if (bracketed) ip = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":")); // 203.0.113.7:443
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice(7); // IPv4-mapped IPv6
  // Only address characters, so the value is safe inside a counter key.
  return /^[0-9a-f:.]{2,45}$/.test(ip) ? ip : "";
}

/** "Too many attempts. Try again in 12 minutes." */
export function tooManyAttemptsMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
