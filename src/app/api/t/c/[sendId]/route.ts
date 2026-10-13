import type { NextRequest } from "next/server";
import { isBotUserAgent, recordClick } from "@/lib/sending";
import { getLinkContext, verifyClick, type LinkContext } from "@/lib/tokens";

// Click-tracking redirect. Public (see src/proxy.ts). The target URL is
// HMAC-signed together with the send id, so this can't be used as an open
// redirect. Link scanners and bots (by User-Agent, see isBotUserAgent) are
// redirected like everyone else, but their clicks aren't counted.

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const invalid = () => textResponse("Invalid link", 400);
const unavailable = () => textResponse("This link is temporarily unavailable. Please try again in a few minutes.", 503);

/** Signing context, or null when the database isn't set up / reachable. */
async function linkContext(): Promise<LinkContext | null> {
  try {
    return await getLinkContext();
  } catch (err) {
    console.error("[tracking] cannot verify click links right now", err);
    return null;
  }
}

/** The verified http(s) target, or null. */
function target(ctx: LinkContext, sendId: string, request: NextRequest): URL | null {
  const u = request.nextUrl.searchParams.get("u");
  const s = request.nextUrl.searchParams.get("s");
  if (!u || !verifyClick(ctx, sendId, u, s)) return null;
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function redirectTo(url: URL): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ sendId: string }> }) {
  const { sendId } = await params;
  const ctx = await linkContext();
  if (!ctx) return unavailable();
  const url = target(ctx, sendId, request);
  if (!url) return invalid();
  if (!isBotUserAgent(request.headers.get("user-agent"))) {
    try {
      await recordClick(sendId, request.nextUrl.searchParams.get("u")!);
    } catch (err) {
      console.error("[tracking] failed to record click", err);
    }
  }
  return redirectTo(url);
}

// Link scanners often probe with HEAD: redirect without counting a click.
export async function HEAD(request: NextRequest, { params }: { params: Promise<{ sendId: string }> }) {
  const { sendId } = await params;
  const ctx = await linkContext();
  if (!ctx) return unavailable();
  const url = target(ctx, sendId, request);
  return url ? redirectTo(url) : invalid();
}
