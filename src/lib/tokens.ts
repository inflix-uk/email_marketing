import { createHmac, timingSafeEqual } from "node:crypto";
import { getAuthSecret, getSettings } from "./settings";

// HMAC signatures for public links (unsubscribe, click tracking) so they
// can't be forged or turned into an open redirect.
//
// The builders are pure: they take a LinkContext (app URL + secret) so the
// message builder stays unit-testable. Get one with `await getLinkContext()`.

export interface LinkContext {
  /** Public app URL without a trailing slash. */
  appUrl: string;
  secret: string;
}

export async function getLinkContext(): Promise<LinkContext> {
  const [settings, secret] = await Promise.all([getSettings(), getAuthSecret()]);
  return { appUrl: settings.appUrl.replace(/\/+$/, ""), secret };
}

export function sign(ctx: LinkContext, value: string): string {
  return createHmac("sha256", ctx.secret).update(value).digest("base64url").slice(0, 22);
}

export function verify(ctx: LinkContext, value: string, signature: string | null | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(sign(ctx, value));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Public unsubscribe page for one email send. */
export function buildUnsubscribeUrl(ctx: LinkContext, sendId: string): string {
  return `${ctx.appUrl}/u/${sendId}?s=${sign(ctx, `unsub:${sendId}`)}`;
}

/**
 * RFC 8058 one-click endpoint for the List-Unsubscribe / List-Unsubscribe-Post
 * headers (Gmail & Yahoo require these for bulk senders). Accepts POST.
 */
export function buildOneClickUnsubscribeUrl(ctx: LinkContext, sendId: string): string {
  return `${ctx.appUrl}/api/unsubscribe/${sendId}?s=${sign(ctx, `unsub:${sendId}`)}`;
}

export function verifyUnsubscribe(ctx: LinkContext, sendId: string, signature: string | null | undefined): boolean {
  return verify(ctx, `unsub:${sendId}`, signature);
}

/** Placeholder used in previews and test sends, where there is no real send. */
export function previewUnsubscribeUrl(ctx: Pick<LinkContext, "appUrl">): string {
  return `${ctx.appUrl}/u/preview`;
}

/** 1x1 open-tracking pixel. */
export function buildOpenPixelUrl(ctx: LinkContext, sendId: string): string {
  return `${ctx.appUrl}/api/t/o/${sendId}`;
}

/** Click-tracking redirect that records the click then forwards to `url`. */
export function buildClickUrl(ctx: LinkContext, sendId: string, url: string): string {
  const s = sign(ctx, `click:${sendId}|${url}`);
  return `${ctx.appUrl}/api/t/c/${sendId}?u=${encodeURIComponent(url)}&s=${s}`;
}

export function verifyClick(ctx: LinkContext, sendId: string, url: string, signature: string | null | undefined): boolean {
  return verify(ctx, `click:${sendId}|${url}`, signature);
}
