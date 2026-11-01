// The plain-text version of an email. Pure (no Node APIs), so the compose
// form can show the automatic text and the "out of date" warning in the browser.

import { htmlToText } from "./render";

const HIDDEN_ELEMENT_RE = /<(div|span)\b[^>]*display\s*:\s*none[^>]*>([\s\S]*?)<\/\1>/gi;

/** Remove display:none elements (preheaders) - used before generating the text part. */
export function stripHiddenElements(html: string): string {
  return html.replace(HIDDEN_ELEMENT_RE, "");
}

/** Readable text of an email's HTML: links become "text (url)", hidden preheaders are dropped. */
export function htmlToPlainText(html: string): string {
  return htmlToText(stripHiddenElements(html));
}

/** Append the unsubscribe link when the text doesn't contain it already. */
export function ensureUnsubscribeText(text: string, unsubscribeUrl: string): string {
  if (!unsubscribeUrl || text.includes(unsubscribeUrl)) return text;
  return `${text.trimEnd()}\n\n---\nUnsubscribe: ${unsubscribeUrl}`;
}

/**
 * Short fingerprint of an HTML body (FNV-1a, 32 bit). Stored with a hand-written
 * text version, so we can tell the HTML has changed since the text was written.
 */
export function contentFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0") + ":" + value.length.toString(36);
}

/** True when a hand-written text version exists and the HTML changed after it was written. */
export function isTextVersionStale(textBody: string | null | undefined, textFor: string | null | undefined, html: string): boolean {
  if (!textBody?.trim()) return false;
  return !textFor || textFor !== contentFingerprint(html);
}
