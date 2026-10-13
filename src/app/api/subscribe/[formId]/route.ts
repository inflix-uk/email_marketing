import { after, type NextRequest } from "next/server";
import type { Form } from "@/db/schema";
import { handleSignup } from "@/lib/forms/signup";
import { getForm } from "@/lib/forms/store";
import { parseSubmission } from "@/lib/forms/validation";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Public sign-up endpoint (see src/proxy.ts): the hosted page /f/<id> and the
// embed snippets on other websites post here.
// - Form posts (urlencoded / multipart) are answered with a redirect to the
//   result page or the form's own redirect URL.
// - JSON posts (or `Accept: application/json`) are answered with JSON.
// - CORS is open to any origin; no cookies are read.
// The answer never says whether the address was already known.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400",
};

/** Submissions per IP address. */
const IP_LIMIT = { limit: 10, windowSeconds: 10 * 60 };
/** Shared bucket for requests whose IP can't be determined - looser, so it doesn't block everyone. */
const UNKNOWN_IP_LIMIT = { limit: 100, windowSeconds: 10 * 60 };
/** Submissions per email address (whoever sends them). */
const EMAIL_LIMIT = { limit: 5, windowSeconds: 10 * 60 };
const MAX_BODY_BYTES = 20_000;

const CONFIRM_MESSAGE = "Almost done - check your inbox and click the link to confirm.";

type ErrorCode = "unavailable" | "invalid_request" | "invalid_email" | "missing_field" | "too_long" | "rate_limited" | "server_error";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

type Params = { params: Promise<{ formId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { formId } = await params;
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  const wantsJson = contentType.includes("application/json") || (accept.includes("application/json") && !accept.includes("text/html"));
  const embed = request.nextUrl.searchParams.get("embed") === "1";

  const page = (query: Record<string, string>) => {
    const qs = new URLSearchParams({ ...query, ...(embed ? { embed: "1" } : {}) }).toString();
    return `/f/${encodeURIComponent(formId)}${qs ? `?${qs}` : ""}`;
  };
  const redirect = (location: string) =>
    new Response(null, { status: 303, headers: { ...CORS, Location: location, "Cache-Control": "no-store" } });
  const json = (body: object, status: number, extra: Record<string, string> = {}) =>
    Response.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store", ...extra } });

  const fail = (status: number, code: ErrorCode, message: string, extra: Record<string, string> = {}) =>
    wantsJson
      ? json({ ok: false, error: { code, message } }, status, extra)
      : redirect(code === "unavailable" ? page({}) : page({ error: code }));

  const succeed = (form: Form) => {
    if (wantsJson) {
      return json(
        {
          ok: true,
          confirmation_required: form.doubleOptIn,
          message: form.doubleOptIn ? CONFIRM_MESSAGE : form.successMessage,
          redirect_url: form.redirectUrl,
        },
        200,
      );
    }
    return redirect(form.redirectUrl ?? page({ done: "1" }));
  };

  try {
    const ip = clientIp(request.headers);
    const byIp = await rateLimit(`subscribe:ip:${ip}`, ip === "unknown" ? UNKNOWN_IP_LIMIT : IP_LIMIT);
    if (!byIp.ok) {
      return fail(429, "rate_limited", "Too many attempts. Please try again in a few minutes.", {
        "Retry-After": String(byIp.retryAfterSeconds),
      });
    }

    const form = await getForm(formId);
    if (!form || !form.active) return fail(404, "unavailable", "This form is not available.");

    const raw = await readBody(request, contentType);
    if (!raw) return fail(400, "invalid_request", "Send the form as JSON or as a normal HTML form post.");

    const parsed = parseSubmission(form.fields, raw);
    if (!parsed.ok) {
      // Bots that fill in the hidden field get the normal answer, and nothing is saved.
      if (parsed.bot) return succeed(form);
      return fail(422, parsed.code, parsed.message);
    }

    const byEmail = await rateLimit(`subscribe:email:${parsed.submission.email}`, EMAIL_LIMIT);
    if (!byEmail.ok) {
      return fail(429, "rate_limited", "Too many attempts. Please try again in a few minutes.", {
        "Retry-After": String(byEmail.retryAfterSeconds),
      });
    }

    const { followUp } = await handleSignup({ form, submission: parsed.submission, ip: ip === "unknown" ? null : ip });
    // Confirmation email + automations run after the response, so every
    // submission takes the same time whether the address was known or not.
    after(followUp);
    return succeed(form);
  } catch (err) {
    console.error("[subscribe] sign-up failed", err);
    return fail(500, "server_error", "Something went wrong. Please try again in a moment.");
  }
}

/** Read at most MAX_BODY_BYTES of the body; null when it is larger or unreadable. */
async function readLimited(request: Request): Promise<Uint8Array | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** The posted key/value pairs (JSON object, urlencoded or multipart form), or null when unreadable. */
async function readBody(request: Request, contentType: string): Promise<Record<string, unknown> | null> {
  const bytes = await readLimited(request);
  if (!bytes) return null;
  try {
    if (contentType.includes("application/json")) {
      const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
      const { fields, ...rest } = body as Record<string, unknown>;
      // Custom fields may be sent flat or inside "fields".
      const nested = typeof fields === "object" && fields !== null && !Array.isArray(fields) ? fields : {};
      return { ...nested, ...rest };
    }
    if (contentType.includes("multipart/form-data")) {
      // The original header: the multipart boundary is case-sensitive.
      const header = request.headers.get("content-type") ?? contentType;
      const data = await new Response(bytes.slice().buffer, { headers: { "Content-Type": header } }).formData();
      const out: Record<string, unknown> = {};
      for (const [key, value] of data.entries()) if (typeof value === "string" && !(key in out)) out[key] = value;
      return out;
    }
    // application/x-www-form-urlencoded (what a plain <form> sends) and anything else form-like.
    const out: Record<string, unknown> = {};
    for (const [key, value] of new URLSearchParams(new TextDecoder().decode(bytes))) if (!(key in out)) out[key] = value;
    return out;
  } catch {
    return null;
  }
}
