// Visible-text extraction for the spam check. Pure (no DOM), so it runs in the
// browser, the server and unit tests alike.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  euro: "€",
  pound: "£",
  zwnj: "",
  zwj: "",
  shy: "",
};

/** Decode the common HTML entities (unknown ones are left as they are). */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, name: string) => {
    const key = name.toLowerCase();
    if (key.startsWith("#")) {
      const code = key.startsWith("#x") ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      // Zero-width and soft-hyphen characters (often used in preheaders) count as nothing.
      if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xad || code === 0x34f) return "";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[key] ?? match;
  });
}

// A tag with attribute values that may contain ">" inside quotes.
const TAG_RE = /<\/?[a-z][a-z0-9-]*(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const BLOCK_TAG_RE = /<\/?(?:p|div|br|hr|tr|td|th|li|ul|ol|table|h[1-6]|blockquote|section|article|header|footer|center|img|button|dt|dd|tbody|thead)\b/i;

/** Strip markup that never shows: comments, <head>, <style>, <script>, <title>, <template>, conditional comments. */
export function stripInvisibleMarkup(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ")
    .replace(/<!doctype[^>]*>/gi, " ")
    .replace(/<(head|style|script|title|template|noscript|xml)\b[\s\S]*?<\/\1\s*>/gi, " ")
    // An unclosed <style>/<script> hides everything after it.
    .replace(/<(style|script)\b[\s\S]*$/i, " ");
}

/**
 * The text a reader sees: no tags, attributes, CSS, scripts or comments;
 * entities decoded; whitespace collapsed. Block-level tags become spaces so
 * words in neighbouring cells don't run together.
 */
export function visibleText(html: string): string {
  const withoutHidden = stripInvisibleMarkup(html);
  const noTags = withoutHidden.replace(TAG_RE, (tag) => (BLOCK_TAG_RE.test(tag) ? " " : ""));
  // Stray "<" from malformed markup stays as text (it is visible), but leftover partial tags are dropped.
  const cleaned = noTags.replace(/<\/?[a-z][^<>]*$/i, " ");
  return decodeHtmlEntities(cleaned).replace(/\s+/g, " ").trim();
}

export interface ImageInfo {
  /** The raw <img ...> tag. */
  tag: string;
  src: string;
  /** null when the alt attribute is missing (alt="" is a deliberate empty alt). */
  alt: string | null;
  /** True for 1x1 tracking pixels / spacers, which don't count as content. */
  tiny: boolean;
}

function attribute(tag: string, name: string): string | null {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = re.exec(tag);
  if (!m) {
    // Bare attribute, e.g. <img alt src=...>
    return new RegExp(`\\s${name}(?=[\\s/>])`, "i").test(tag) ? "" : null;
  }
  return decodeHtmlEntities(m[1] ?? m[2] ?? m[3] ?? "");
}

/** The <img> tags in the visible part of the email. */
export function findImages(html: string): ImageInfo[] {
  const body = stripInvisibleMarkup(html);
  const images: ImageInfo[] = [];
  for (const m of body.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const tag = m[0];
    const width = parseInt(attribute(tag, "width") ?? "", 10);
    const height = parseInt(attribute(tag, "height") ?? "", 10);
    const tiny = (Number.isFinite(width) && width <= 2) || (Number.isFinite(height) && height <= 2);
    images.push({ tag, src: attribute(tag, "src") ?? "", alt: attribute(tag, "alt"), tiny });
  }
  return images;
}

/** Every URL in href/src attributes plus bare URLs in the visible text. */
export function findUrls(html: string): string[] {
  const body = stripInvisibleMarkup(html);
  const urls: string[] = [];
  for (const m of body.matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    urls.push(decodeHtmlEntities(m[1] ?? m[2] ?? m[3] ?? "").trim());
  }
  urls.push(...urlsInText(visibleText(html)));
  return urls;
}

/** Web addresses written out in plain text: "https://...", "www...." and bare "host.tld/path". */
export function urlsInText(text: string): string[] {
  const re = new RegExp(
    String.raw`(?:\bhttps?:\/\/|\bwww\.)[^\s<>"')]+|(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s<>"')]*`,
    "gi",
  );
  return text.match(re) ?? [];
}

/** Hostname of a URL or bare "host/path" string, lower-cased, without "www.". */
export function hostOf(url: string): string | null {
  const m = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#:\s]+)|^(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=[/?#]|$)/i.exec(url.trim());
  const host = (m?.[1] ?? m?.[2] ?? "").toLowerCase();
  return host ? host.replace(/^www\./, "") : null;
}
