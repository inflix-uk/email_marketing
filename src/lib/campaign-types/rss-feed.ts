// RSS 2.0 / Atom feeds - a small, dependency-free parser plus the helpers an
// RSS series needs: pick the posts not emailed yet, and render them into the
// email at {{rss_items}}. Pure (no network, no database), unit-tested.

import { escapeHtml } from "@/lib/render";

export interface FeedItem {
  /** guid / Atom id, else the link, else the title: used to never send a post twice. */
  id: string;
  title: string;
  link: string | null;
  /** Plain-text excerpt (tags stripped, at most ~240 characters). */
  excerpt: string;
  image: string | null;
  publishedAt: Date | null;
}

export interface ParsedFeed {
  title: string;
  items: FeedItem[];
}

export class FeedError extends Error {}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", pound: "£", euro: "€", copy: "©",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named ?? entity;
  });
}

/** Element text: CDATA unwrapped, entities decoded (once). */
function textContent(raw: string): string {
  let out = "";
  let rest = raw;
  // CDATA sections are literal; everything else is entity-encoded XML text.
  for (;;) {
    const start = rest.indexOf("<![CDATA[");
    if (start === -1) {
      out += decodeEntities(rest);
      break;
    }
    out += decodeEntities(rest.slice(0, start));
    const end = rest.indexOf("]]>", start + 9);
    if (end === -1) {
      out += rest.slice(start + 9);
      break;
    }
    out += rest.slice(start + 9, end);
    rest = rest.slice(end + 3);
  }
  return out.trim();
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Inner XML of the first <name ...>...</name> (name may include a prefix, e.g. "content:encoded"). */
function child(xml: string, name: string): string | null {
  const re = new RegExp(`<${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(name)}>`, "i");
  const m = re.exec(xml);
  return m ? m[1] : null;
}

function childText(xml: string, ...names: string[]): string {
  for (const name of names) {
    const inner = child(xml, name);
    if (inner !== null) {
      const text = textContent(inner);
      if (text) return text;
    }
  }
  return "";
}

/** Attributes of the first matching tags, e.g. every <link .../> in an Atom entry. */
function tags(xml: string, name: string): Record<string, string>[] {
  const re = new RegExp(`<${escapeRe(name)}(\\s[^>]*?)?/?>`, "gi");
  const out: Record<string, string>[] = [];
  for (const m of xml.matchAll(re)) out.push(attributes(m[1] ?? ""));
  return out;
}

function attributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Elements <name>...</name> (not nested), e.g. every <item>. */
function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(name)}>`, "gi");
  return [...xml.matchAll(re)].map((m) => m[1]);
}

export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(html: string, max = 240): string {
  const text = stripTags(html);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function safeHttpUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function firstImageIn(html: string): string | null {
  const m = /<img\b[^>]*?\bsrc\s*=\s*("([^"]+)"|'([^']+)')/i.exec(html);
  return m ? safeHttpUrl(decodeEntities(m[2] ?? m[3] ?? "")) : null;
}

function itemImage(xml: string, bodyHtml: string): string | null {
  for (const name of ["media:content", "media:thumbnail", "enclosure"]) {
    for (const attrs of tags(xml, name)) {
      const type = attrs.type ?? "";
      const medium = attrs.medium ?? "";
      if (name === "enclosure" && !type.startsWith("image/")) continue;
      if (name === "media:content" && medium && medium !== "image" && !type.startsWith("image/")) continue;
      const url = safeHttpUrl(attrs.url);
      if (url) return url;
    }
  }
  return firstImageIn(bodyHtml);
}

function rssItem(xml: string): FeedItem {
  const title = stripTags(childText(xml, "title"));
  const link = safeHttpUrl(childText(xml, "link"));
  const body = childText(xml, "description") || childText(xml, "content:encoded");
  const full = childText(xml, "content:encoded") || body;
  const guid = childText(xml, "guid");
  return {
    id: guid || link || title,
    title,
    link,
    excerpt: excerpt(body),
    image: itemImage(xml, full),
    publishedAt: parseDate(childText(xml, "pubDate", "dc:date")),
  };
}

function atomLink(xml: string): string | null {
  const links = tags(xml, "link");
  const alternate = links.find((l) => !l.rel || l.rel === "alternate") ?? links[0];
  return safeHttpUrl(alternate?.href);
}

function atomItem(xml: string): FeedItem {
  const title = stripTags(childText(xml, "title"));
  const link = atomLink(xml);
  const body = childText(xml, "summary") || childText(xml, "content");
  const full = childText(xml, "content") || body;
  const id = childText(xml, "id");
  return {
    id: id || link || title,
    title,
    link,
    excerpt: excerpt(body),
    image: itemImage(xml, full),
    publishedAt: parseDate(childText(xml, "published", "updated")),
  };
}

/** Parse an RSS 2.0 / RSS 1.0 (RDF) / Atom document. Throws FeedError when it isn't a feed. */
export function parseFeed(xml: string): ParsedFeed {
  const doc = xml.replace(/<!--[\s\S]*?-->/g, "");
  if (/<feed[\s>]/i.test(doc)) {
    const head = doc.split(/<entry[\s>]/i)[0];
    return {
      title: stripTags(childText(head, "title")),
      items: blocks(doc, "entry").map(atomItem).filter((i) => i.id),
    };
  }
  if (/<(rss|rdf:RDF)[\s>]/i.test(doc) || /<channel[\s>]/i.test(doc)) {
    const channel = child(doc, "channel") ?? doc;
    const head = channel.split(/<item[\s>]/i)[0];
    return {
      title: stripTags(childText(head, "title")),
      items: blocks(doc, "item").map(rssItem).filter((i) => i.id),
    };
  }
  throw new FeedError("This address doesn't look like an RSS or Atom feed.");
}

export interface FeedCursor {
  seenIds: string[];
  lastItemAt: Date | null;
}

/** How many already-emailed post ids are remembered. */
export const SEEN_IDS_CAP = 500;

/**
 * Posts to email in this run: not emailed before (by id), not older than the
 * newest post already emailed, newest first, at most `max`. The first run
 * (empty cursor) simply takes the newest `max` posts.
 */
export function selectNewItems(items: FeedItem[], cursor: FeedCursor, max: number): FeedItem[] {
  const seen = new Set(cursor.seenIds);
  const unique = new Map<string, FeedItem>();
  for (const item of items) {
    if (seen.has(item.id) || (item.link && seen.has(item.link))) continue;
    if (cursor.lastItemAt && item.publishedAt && item.publishedAt.getTime() <= cursor.lastItemAt.getTime()) continue;
    if (!unique.has(item.id)) unique.set(item.id, item);
  }
  const fresh = [...unique.values()];
  // Newest first; undated posts keep their feed order after dated ones.
  fresh.sort((a, b) => (b.publishedAt?.getTime() ?? -Infinity) - (a.publishedAt?.getTime() ?? -Infinity));
  return fresh.slice(0, Math.max(1, Math.floor(max)));
}

/** The cursor after emailing `sent`. */
export function advanceCursor(cursor: FeedCursor, sent: FeedItem[]): FeedCursor {
  const ids = [...sent.map((i) => i.id), ...sent.map((i) => i.link).filter((l): l is string => Boolean(l))];
  const seenIds = [...new Set([...ids, ...cursor.seenIds])].slice(0, SEEN_IDS_CAP);
  let lastItemAt = cursor.lastItemAt;
  for (const item of sent) {
    if (item.publishedAt && (!lastItemAt || item.publishedAt > lastItemAt)) lastItemAt = item.publishedAt;
  }
  return { seenIds, lastItemAt };
}

/** Email-safe HTML for the posts (inline styles, everything escaped). */
export function renderRssItems(items: FeedItem[]): string {
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const rows = items.map((item) => {
    const link = item.link ? escapeHtml(item.link) : null;
    const title = escapeHtml(item.title || "Untitled post");
    const image = item.image
      ? `<img src="${escapeHtml(item.image)}" alt="" width="552" style="display:block;width:100%;max-width:552px;height:auto;border:0;margin:0 0 12px;">`
      : "";
    const heading = link
      ? `<a href="${link}" style="color:#111827;text-decoration:none;">${title}</a>`
      : title;
    const more = link
      ? `<p style="margin:8px 0 0;${font}font-size:14px;"><a href="${link}" style="color:#4f46e5;">Read more</a></p>`
      : "";
    return (
      `<tr><td style="padding:0 0 28px;">` +
      (link && image ? `<a href="${link}">${image}</a>` : image) +
      `<h3 style="margin:0 0 6px;${font}font-size:18px;line-height:24px;color:#111827;">${heading}</h3>` +
      (item.excerpt ? `<p style="margin:0;${font}font-size:15px;line-height:22px;color:#4b5563;">${escapeHtml(item.excerpt)}</p>` : "") +
      more +
      `</td></tr>`
    );
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>`;
}

const RSS_TAG_IN_P = /<p\b[^>]*>\s*\{\{\s*rss_items\s*\}\}\s*<\/p>/gi;
const RSS_TAG = /\{\{\s*rss_items\s*\}\}/gi;

export function hasRssTag(html: string): boolean {
  return /\{\{\s*rss_items\s*\}\}/i.test(html);
}

/**
 * Put the posts into the email at {{rss_items}} (a paragraph holding only the
 * tag is replaced as a whole). Without the tag they go just before </body>.
 */
export function applyRssItems(html: string, items: FeedItem[]): string {
  const block = renderRssItems(items);
  if (hasRssTag(html)) return html.replace(RSS_TAG_IN_P, () => block).replace(RSS_TAG, () => block);
  const body = html.search(/<\/body>/i);
  return body === -1 ? html + block : html.slice(0, body) + block + html.slice(body);
}
