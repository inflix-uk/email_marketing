import { escapeHtml } from "@/lib/render";

// Text handling for the design renderer: escaping that leaves merge tags
// intact, URL sanitising, and the editor's "simple rich text":
//
//   **bold**   *italic*   [link text](https://example.com)
//   a line break = <br>, a blank line = a new paragraph
//   \* \[ \\ = a literal character
//
// Pure and client-safe.

/** Same syntax as `renderMergeTags` in @/lib/render. */
const TAG_SOURCE = String.raw`\{\{\s*[a-zA-Z0-9_.-]+\s*(?:\|[^}]*)?\}\}`;
const TAG_STICKY = new RegExp(TAG_SOURCE, "y");
const TAG_GLOBAL = new RegExp(TAG_SOURCE, "g");

/** The merge tag starting at `index`, if any. */
function tagAt(input: string, index: number): string | null {
  if (input.charCodeAt(index) !== 123 /* { */ || input.charCodeAt(index + 1) !== 123) return null;
  TAG_STICKY.lastIndex = index;
  const match = TAG_STICKY.exec(input);
  return match ? match[0] : null;
}

/**
 * A merge tag is passed through as written so it is filled in when sending
 * (which escapes the value). A tag whose fallback contains markup characters
 * is treated as ordinary text instead, so it can never open a tag or close an
 * attribute in the generated HTML.
 */
function emitTag(tag: string): string {
  return /[<>"]/.test(tag) ? escapeHtml(tag) : tag;
}

/** Escape text for HTML content or a double-quoted attribute, keeping merge tags. */
export function escapeText(input: string): string {
  let out = "";
  let last = 0;
  for (const match of input.matchAll(TAG_GLOBAL)) {
    const index = match.index ?? 0;
    out += escapeHtml(input.slice(last, index)) + emitTag(match[0]);
    last = index + match[0].length;
  }
  return out + escapeHtml(input.slice(last));
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const UNSUBSCRIBE_TAG_RE = /^\{\{\s*unsubscribe_url\s*\}\}$/i;
const BARE_EMAIL_RE = /^[^\s/@:]+@[^\s/@:]+\.[^\s/@:]{2,}$/;
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i;

/** Trim, and write spaces outside merge tags as %20 ("mailto:a@example.com?subject=Hi there"). */
function tidyUrl(raw: string): string {
  const url = raw.trim();
  let out = "";
  let last = 0;
  for (const match of url.matchAll(TAG_GLOBAL)) {
    const index = match.index ?? 0;
    out += url.slice(last, index).replace(/ /g, "%20") + match[0];
    last = index + match[0].length;
  }
  return out + url.slice(last).replace(/ /g, "%20");
}

function hasUnsafeUrlChars(url: string): boolean {
  // Merge tags (which may contain spaces) are checked separately by emitTag.
  return /[\u0000- <>"'`\\\u007f]/.test(url.replace(TAG_GLOBAL, ""));
}

/**
 * A link target that is safe to put in an href: http(s) or mailto only.
 * "example.com/page" becomes https://..., "jo@example.com" becomes mailto:...,
 * and {{unsubscribe_url}} is allowed on its own. Anything else (javascript:,
 * data:, relative paths, other merge tags as the whole URL) returns "".
 */
export function sanitizeLinkUrl(raw: string): string {
  const url = tidyUrl(raw);
  if (!url) return "";
  if (UNSUBSCRIBE_TAG_RE.test(url)) return "{{unsubscribe_url}}";
  if (hasUnsafeUrlChars(url)) return "";
  if (/^https?:\/\/[^/]/i.test(url)) return url;
  if (/^mailto:[^\s]+@[^\s]+/i.test(url)) return url;
  if (BARE_EMAIL_RE.test(url)) return `mailto:${url}`;
  if (BARE_DOMAIN_RE.test(url)) return `https://${url}`;
  return "";
}

/** An image source that is safe to send: an absolute http(s) URL, or "". */
export function sanitizeImageUrl(raw: string): string {
  const url = tidyUrl(raw);
  if (!url || hasUnsafeUrlChars(url)) return "";
  if (/^https?:\/\/[^/]/i.test(url)) return url;
  if (BARE_DOMAIN_RE.test(url) && url.includes("/")) return `https://${url}`;
  return "";
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

const ESCAPABLE = new Set(["\\", "*", "[", "]", "(", ")"]);
const LINK_STICKY = /\[((?:\\.|[^\]\\\n])+)\]\(((?:\{\{[^}\n]*\}\}|[^)\s])+)\)/y;

/**
 * Index of the marker ("*" or "**") that closes a span opened before `from`,
 * or -1. Escapes and merge tags are skipped; a single "*" never matches half
 * of a "**" pair.
 */
function findClosing(src: string, from: number, marker: "*" | "**"): number {
  let i = from;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && ESCAPABLE.has(src[i + 1])) {
      i += 2;
      continue;
    }
    if (ch === "{") {
      const tag = tagAt(src, i);
      if (tag) {
        i += tag.length;
        continue;
      }
    }
    if (ch === "*") {
      let run = 1;
      while (src[i + run] === "*") run++;
      // In a run of three, the inner span closes first and the outer one last.
      if (marker === "**" && run >= 2) return i + run - 2;
      if (marker === "*" && (run === 1 || run === 3)) return i + run - 1;
      i += run;
      continue;
    }
    i++;
  }
  return -1;
}

interface InlineContext {
  /** Inline style for links. */
  linkStyle: string;
  inLink?: boolean;
}

function renderInline(src: string, ctx: InlineContext): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\" && ESCAPABLE.has(src[i + 1])) {
      out += escapeHtml(src[i + 1]);
      i += 2;
      continue;
    }

    if (ch === "{") {
      const tag = tagAt(src, i);
      if (tag) {
        out += emitTag(tag);
        i += tag.length;
        continue;
      }
    }

    if (ch === "*") {
      const marker = src[i + 1] === "*" ? "**" : "*";
      const start = i + marker.length;
      const end = findClosing(src, start, marker);
      const inner = end === -1 ? "" : src.slice(start, end);
      if (inner.trim() && !/^\s|\s$/.test(inner)) {
        const element = marker === "**" ? "strong" : "em";
        out += `<${element}>${renderInline(inner, ctx)}</${element}>`;
        i = end + marker.length;
        continue;
      }
      out += marker;
      i += marker.length;
      continue;
    }

    if (ch === "[" && !ctx.inLink) {
      LINK_STICKY.lastIndex = i;
      const match = LINK_STICKY.exec(src);
      if (match) {
        const label = renderInline(match[1], { ...ctx, inLink: true });
        const href = sanitizeLinkUrl(match[2]);
        // An unsafe target drops the link but keeps its text.
        out += href ? `<a href="${escapeText(href)}" style="${ctx.linkStyle}">${label}</a>` : label;
        i += match[0].length;
        continue;
      }
    }

    if (ch === "\n") {
      out += "<br>";
      i++;
      continue;
    }

    out += escapeHtml(ch);
    i++;
  }
  return out;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** One line of rich text (no paragraphs), as inline HTML. */
export function renderRichInline(text: string, opts: { linkStyle: string }): string {
  return renderInline(normalizeNewlines(text).trim(), { linkStyle: opts.linkStyle });
}

/** Rich text split into paragraphs; each entry is that paragraph's inline HTML. */
export function renderRichParagraphs(text: string, opts: { linkStyle: string }): string[] {
  return normalizeNewlines(text)
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => renderInline(paragraph, { linkStyle: opts.linkStyle }));
}

/** True when the text has anything to show. */
export function hasText(text: string): boolean {
  return text.trim().length > 0;
}
