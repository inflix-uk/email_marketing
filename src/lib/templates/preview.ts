import { renderMergeTags, SAMPLE_CONTACT } from "@/lib/render";

// Builds the HTML document shown in template previews. Client-safe.

/**
 * Stand-in for the per-recipient unsubscribe link in previews. Same path as
 * `previewUnsubscribeUrl()` in @/lib/tokens, which can't be used here because
 * it depends on node:crypto (relative URLs resolve against the app's origin).
 */
export const PREVIEW_UNSUBSCRIBE_URL = "/u/preview";

/** Replace merge tags with the sample contact's data. */
export function renderPreviewHtml(html: string): string {
  return renderMergeTags(
    html,
    { contact: SAMPLE_CONTACT, unsubscribeUrl: PREVIEW_UNSUBSCRIBE_URL },
    { escape: true },
  );
}

const BASE_TAG = '<base target="_blank">';

/**
 * Make links open in a new tab by adding <base target="_blank"> as the first
 * element of <head> (the first <base> with a target wins, so it overrides
 * any <base> in the template). Works for full documents and fragments.
 */
export function withBaseTarget(html: string): string {
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return insertAt(html, head.index + head[0].length, BASE_TAG);
  const root = /<html\b[^>]*>/i.exec(html);
  if (root) return insertAt(html, root.index + root[0].length, `<head>${BASE_TAG}</head>`);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return insertAt(html, doctype[0].length, BASE_TAG);
  return BASE_TAG + html;
}

function insertAt(input: string, index: number, text: string): string {
  return input.slice(0, index) + text + input.slice(index);
}

/** The full srcDoc for a preview iframe. */
export function buildPreviewDocument(html: string): string {
  return withBaseTarget(renderPreviewHtml(html));
}
