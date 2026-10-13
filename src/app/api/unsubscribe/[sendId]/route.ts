import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeBySend } from "@/lib/sending";
import { getLinkContext, verifyUnsubscribe } from "@/lib/tokens";

// RFC 8058 one-click unsubscribe, the target of the List-Unsubscribe header.
// Public (see src/proxy.ts): mailbox providers POST here without cookies.

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sendId: string }> }) {
  const { sendId } = await params;
  let ctx;
  try {
    ctx = await getLinkContext();
  } catch (err) {
    // Database not configured / unreachable: 5xx so providers retry later.
    console.error("[unsubscribe] cannot verify unsubscribe links right now", err);
    return text("Unsubscribe is temporarily unavailable, please try again later.", 503);
  }
  if (!verifyUnsubscribe(ctx, sendId, request.nextUrl.searchParams.get("s"))) {
    return text("Invalid unsubscribe link", 400);
  }
  try {
    const result = await unsubscribeBySend(sendId);
    // Deleted send/contact: nothing left to email, so the request is satisfied.
    if (result === "not_found") return text("This subscription no longer exists.");
    return text(result === "already" ? "You were already unsubscribed." : "You have been unsubscribed.");
  } catch (err) {
    console.error("[unsubscribe] one-click unsubscribe failed", err);
    return text("Something went wrong, please try again.", 500);
  }
}

/** A person opened the header URL in a browser: show the confirmation page. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ sendId: string }> }) {
  const { sendId } = await params;
  const url = request.nextUrl.clone();
  url.pathname = `/u/${encodeURIComponent(sendId)}`;
  url.search = "";
  const s = request.nextUrl.searchParams.get("s");
  if (s) url.searchParams.set("s", s);
  return NextResponse.redirect(url, 303);
}
