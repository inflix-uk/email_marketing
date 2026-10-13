import { sign, verify, type LinkContext } from "@/lib/tokens";

// Signed confirmation links for double opt-in: /c/<contactId>.<formId>.<issuedAt>.<signature>
// Pure: pass a LinkContext from getLinkContext(). The issue time is part of the
// signed value so a link expires and can't undo a later unsubscribe.

export interface ConfirmToken {
  contactId: string;
  formId: string;
  issuedAt: Date;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function signedValue(contactId: string, formId: string, stamp: string): string {
  return `confirm:${contactId}:${formId}:${stamp}`;
}

export function buildConfirmToken(ctx: LinkContext, contactId: string, formId: string, issuedAt = new Date()): string {
  const stamp = Math.floor(issuedAt.getTime() / 1000).toString(36);
  return `${contactId}.${formId}.${stamp}.${sign(ctx, signedValue(contactId, formId, stamp))}`;
}

export function buildConfirmUrl(ctx: LinkContext, contactId: string, formId: string, issuedAt = new Date()): string {
  return `${ctx.appUrl}/c/${buildConfirmToken(ctx, contactId, formId, issuedAt)}`;
}

/** The token's contents when the signature is valid, else null. */
export function verifyConfirmToken(ctx: LinkContext, token: string): ConfirmToken | null {
  if (token.length > 300) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [contactId, formId, stamp, signature] = parts;
  if (!ID_RE.test(contactId) || !ID_RE.test(formId) || !/^[0-9a-z]{1,12}$/.test(stamp)) return null;
  if (!verify(ctx, signedValue(contactId, formId, stamp), signature)) return null;
  const seconds = parseInt(stamp, 36);
  if (!Number.isSafeInteger(seconds)) return null;
  return { contactId, formId, issuedAt: new Date(seconds * 1000) };
}
