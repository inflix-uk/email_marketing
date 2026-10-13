import type { ApiKeyDoc } from "@/db/schema";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { authenticateApiKey, bearerToken } from "./keys";

// Shared plumbing for the /api/v1 route handlers: JSON responses, errors with
// proper status codes, API key authentication and rate limiting.
// Web-standard Request / Response only (no next/* imports).

const HEADERS = { "Cache-Control": "no-store" };

/** Requests per key per minute. */
const KEY_LIMIT = { limit: 120, windowSeconds: 60 };
/** Requests with a missing / wrong key per IP per minute. */
const BAD_KEY_LIMIT = { limit: 30, windowSeconds: 60 };
/** Largest JSON body accepted. */
export const MAX_BODY_BYTES = 100_000;

export function apiJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...HEADERS, ...headers } });
}

/** `{ "error": { "code": "...", "message": "..." } }` */
export function apiError(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return apiJson({ error: { code, message } }, status, headers);
}

function tooManyRequests(retryAfterSeconds: number): Response {
  return apiError(429, "rate_limited", `Too many requests. Try again in ${retryAfterSeconds} seconds.`, {
    "Retry-After": String(retryAfterSeconds),
  });
}

/** Check the `Authorization: Bearer <key>` header. Returns the key, or the error response to send. */
export async function authenticate(request: Request): Promise<{ ok: true; key: ApiKeyDoc } | { ok: false; response: Response }> {
  const token = bearerToken(request.headers.get("authorization"));
  const key = await authenticateApiKey(token);
  if (!key) {
    const limited = await rateLimit(`api:bad-key:${clientIp(request.headers)}`, BAD_KEY_LIMIT);
    if (!limited.ok) return { ok: false, response: tooManyRequests(limited.retryAfterSeconds) };
    return {
      ok: false,
      response: apiError(
        401,
        "unauthorized",
        token ? "This API key is not valid." : "Send your API key in the Authorization header: Bearer <key>.",
        { "WWW-Authenticate": "Bearer" },
      ),
    };
  }
  const limited = await rateLimit(`api:key:${key._id}`, KEY_LIMIT);
  if (!limited.ok) return { ok: false, response: tooManyRequests(limited.retryAfterSeconds) };
  return { ok: true, key };
}

/** Read a JSON object body. Returns the object, or the error response to send. */
export async function readJsonObject(
  request: Request,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const tooLarge = { ok: false as const, response: apiError(413, "too_large", "The request body is too large.") };
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return tooLarge;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "Could not read the request body.") };
  }
  if (Buffer.byteLength(text) > maxBytes) return tooLarge;
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return { ok: true, body: body as Record<string, unknown> };
    }
  } catch {
    // fall through
  }
  return { ok: false, response: apiError(400, "invalid_json", "The request body must be a JSON object.") };
}

/** Wrap a handler so unexpected failures become a JSON 500 instead of an HTML error page. */
export async function handleApi(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (err) {
    console.error("[api] request failed", err);
    return apiError(500, "server_error", "Something went wrong. Please try again.");
  }
}
