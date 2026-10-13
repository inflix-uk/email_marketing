import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

// Optimistic check only (no database access here): requests without a
// session cookie are sent to /login. The (app) layout and every server
// action / route handler verify the session for real via requireSession().

// Reachable without logging in: setup + login + password reset, the public
// links inside emails (unsubscribe, tracking, hosted images), sign-up forms
// and their confirmation links, provider webhooks, and the key-authenticated API.
const PUBLIC_PREFIXES = [
  "/setup",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/u/",
  "/f/",
  "/c/",
  "/api/unsubscribe/",
  "/api/t/",
  "/api/files/",
  "/api/subscribe/",
  "/api/webhooks/",
  "/api/v1/",
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname + search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"],
};
