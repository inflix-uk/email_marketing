import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { isWebhookProvider, parseWebhook, recordBounce, recordComplaint } from "@/lib/sending";
import { getWebhookSecret } from "@/lib/settings";

// Bounce / complaint webhooks from the email provider. Public (see
// src/proxy.ts): providers call it without cookies, so the secret `token` in
// the URL (Settings > Deliverability shows the full URL) is the authorisation.
//
//   POST /api/webhooks/<ses|resend|brevo|mailgun|generic>?token=<secret>
//
// Understood payloads always get a 200 - including events we ignore (soft
// bounces, deliveries...) - so providers don't retry or disable the webhook.
// Recording is idempotent, so their retries after a 5xx are harmless.

const MAX_BODY_BYTES = 512 * 1024;

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Constant-time comparison (hashing first makes the lengths equal). */
function sameToken(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

type Params = { params: Promise<{ provider: string }> };

/** Checks the provider name and the token. Returns an error response, or null when the caller may proceed. */
async function authorize(request: NextRequest, provider: string): Promise<Response | null> {
  if (!isWebhookProvider(provider)) return json({ error: "Unknown provider" }, 404);
  let secret: string;
  try {
    secret = await getWebhookSecret();
  } catch (err) {
    // Database not configured / unreachable: 5xx so the provider retries later.
    console.error("[webhooks] cannot verify the token right now", err);
    return json({ error: "Temporarily unavailable" }, 503);
  }
  const token = request.nextUrl.searchParams.get("token") ?? "";
  return token && sameToken(token, secret) ? null : json({ error: "Invalid token" }, 401);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { provider } = await params;
  const denied = await authorize(request, provider);
  if (denied) return denied;
  if (!isWebhookProvider(provider)) return json({ error: "Unknown provider" }, 404);

  // Amazon SNS posts JSON as text/plain, so read the text whatever the content type says.
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "Payload too large" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = parseWebhook(provider, body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  if (parsed.confirmUrl) {
    // Amazon SNS handshake. parseWebhook only returns https://*.amazonaws.com URLs.
    try {
      const res = await fetch(parsed.confirmUrl, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log("[webhooks] confirmed the Amazon SNS subscription");
      return json({ ok: true, confirmed: true });
    } catch (err) {
      console.error("[webhooks] could not confirm the Amazon SNS subscription", err);
      return json({ error: "Could not confirm the subscription" }, 502);
    }
  }

  let bounces = 0;
  let complaints = 0;
  try {
    for (const event of parsed.events) {
      if (event.type === "bounce") {
        await recordBounce(event);
        bounces++;
      } else {
        await recordComplaint(event);
        complaints++;
      }
    }
  } catch (err) {
    console.error(`[webhooks] failed to record a ${provider} notification`, err);
    return json({ error: "Temporarily unavailable" }, 500);
  }
  return json({ ok: true, bounces, complaints });
}

/** Lets you check the URL in a browser: 200 when the provider and token are right. */
export async function GET(request: NextRequest, { params }: Params) {
  const { provider } = await params;
  return (await authorize(request, provider)) ?? json({ ok: true, provider, hint: "Providers must POST to this URL." });
}
