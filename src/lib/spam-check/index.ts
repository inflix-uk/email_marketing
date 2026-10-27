// Live spam check: plain-language suggestions about content that spam filters
// tend to dislike. Pure and synchronous - runs in the browser on every edit
// (debounced) and on the server. These are hints, never blockers.

import { findImages, findUrls, hostOf, stripInvisibleMarkup, urlsInText, visibleText } from "./text";

export { visibleText, decodeHtmlEntities, findImages, findUrls, hostOf } from "./text";

export type SpamSeverity = "warning" | "info";
export type SpamLocation = "subject" | "preheader" | "body" | "text";

export type SpamRule =
  | "empty-subject"
  | "long-subject"
  | "caps-words"
  | "caps-ratio"
  | "repeated-punctuation"
  | "suspect-phrase"
  | "image-heavy"
  | "missing-alt"
  | "link-shortener"
  | "no-unsubscribe";

export interface SpamFinding {
  /** Stable for the same problem in the same place (used to dismiss it). */
  id: string;
  rule: SpamRule;
  severity: SpamSeverity;
  location: SpamLocation;
  /** The text that triggered it (shortened). */
  match: string;
  suggestion: string;
}

export interface SpamCheckInput {
  subject?: string | null;
  preheader?: string | null;
  html?: string | null;
  /** Plain-text version, when written separately from the HTML. */
  text?: string | null;
}

export const LONG_SUBJECT_CHARS = 70;

/**
 * Phrases spam filters weigh heavily. Ordinary marketing words (sale,
 * discount, offer, free delivery...) are deliberately not listed.
 */
export const SUSPECT_PHRASES: readonly string[] = [
  "act now",
  "act immediately",
  "100% free",
  "100% satisfied",
  "risk-free",
  "risk free",
  "click here",
  "click below",
  "winner",
  "you have been selected",
  "you've been selected",
  "congratulations, you",
  "guaranteed",
  "no cost",
  "no fees",
  "no hidden fees",
  "cash bonus",
  "free money",
  "free cash",
  "earn money",
  "make money fast",
  "double your income",
  "extra income",
  "lowest price",
  "best price guaranteed",
  "once in a lifetime",
  "limited time only",
  "urgent response",
  "while supplies last",
  "order now",
  "buy direct",
  "no credit check",
  "miracle",
  "weight loss",
  "lose weight",
  "work from home",
  "this is not spam",
  "not junk",
  "dear friend",
  "claim your prize",
  "you won",
  "100% guaranteed",
  "no obligation",
  "apply now",
  "get paid",
  "million dollars",
];

/** Common link shorteners: filters distrust them because they hide the destination. */
export const LINK_SHORTENERS: readonly string[] = [
  "bit.ly",
  "bitly.com",
  "tinyurl.com",
  "goo.gl",
  "t.co",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
  "tiny.cc",
  "rb.gy",
  "bl.ink",
  "t.ly",
  "v.gd",
  "lnkd.in",
  "shorte.st",
  "adf.ly",
  "s.id",
  "clck.ru",
];

/** Short all-caps words that are ordinary (acronyms) and not "shouting". */
const ALLOWED_CAPS = new Set([
  "FAQ", "USA", "UK", "EU", "HTML", "HTTP", "HTTPS", "URL", "PDF", "API", "CEO", "CTO", "SMS", "VAT", "GDPR", "NHS",
  "ASAP", "RSVP", "LTD", "PLC", "LLC", "INC", "AM", "PM", "GMT", "UTC", "BST", "CET", "EST", "PST", "TV", "PC", "ID",
  "OK", "DIY", "SEO", "ROI", "KPI", "CRM", "SaaS", "IT", "HR", "PS", "UX", "UI", "AI", "NEW",
]);

const MERGE_TAG_RE = /\{\{[^{}]*\}\}/g;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAIL_RE = /\S+@\S+\.\S+/g;

/** Text with merge tags, URLs and email addresses removed (they aren't wording). */
function wording(text: string): string {
  return text.replace(MERGE_TAG_RE, " ").replace(URL_RE, " ").replace(EMAIL_RE, " ");
}

function shorten(value: string, max = 60): string {
  const v = value.replace(/\s+/g, " ").trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PHRASE_RES = SUSPECT_PHRASES.map((phrase) => ({
  phrase,
  // Word boundaries that also work next to "%", "-" and punctuation.
  re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu"),
}));

const PHRASE_SUGGESTIONS: Record<string, string> = {
  "click here": "Use a link that says where it goes, e.g. \"See the new range\".",
  "click below": "Use a link that says where it goes, e.g. \"See the new range\".",
  "act now": "Say what happens and when instead, e.g. \"Offer ends Friday\".",
  "act immediately": "Say what happens and when instead, e.g. \"Offer ends Friday\".",
  "order now": "Try a calmer call to action, e.g. \"Shop the collection\".",
  "apply now": "Try a calmer call to action, e.g. \"Start your application\".",
};

const DEFAULT_PHRASE_SUGGESTION = "Spam filters watch for this phrase. Try plainer wording.";

const LOCATION_NAMES: Record<SpamLocation, string> = {
  subject: "subject",
  preheader: "preview text",
  body: "email",
  text: "plain-text version",
};

function finding(
  rule: SpamRule,
  severity: SpamSeverity,
  location: SpamLocation,
  match: string,
  suggestion: string,
): SpamFinding {
  return { id: `${rule}:${location}:${match.toLowerCase()}`, rule, severity, location, match: shorten(match), suggestion };
}

/** Words of 4+ letters written entirely in capitals (acronyms excluded). */
export function shoutedWords(text: string): string[] {
  const words = wording(text).match(/[\p{L}][\p{L}'’]*/gu) ?? [];
  return words.filter((w) => {
    const letters = w.replace(/['’]/g, "");
    return letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() && !ALLOWED_CAPS.has(letters);
  });
}

/** Share of letters that are capitals (0-1) and the number of letters counted. */
export function capitalsRatio(text: string): { ratio: number; letters: number } {
  const letters = wording(text).match(/\p{L}/gu) ?? [];
  const cased = letters.filter((l) => l.toUpperCase() !== l.toLowerCase());
  if (cased.length === 0) return { ratio: 0, letters: 0 };
  const upper = cased.filter((l) => l === l.toUpperCase()).length;
  return { ratio: upper / cased.length, letters: cased.length };
}

function checkWording(text: string, location: SpamLocation, out: SpamFinding[]): void {
  if (!text.trim()) return;
  const where = LOCATION_NAMES[location];
  const isShort = location === "subject" || location === "preheader";

  // Capitals: overall ratio first; individual shouted words only if the ratio is fine.
  const { ratio, letters } = capitalsRatio(text);
  const minLetters = isShort ? 12 : 80;
  const maxRatio = isShort ? 0.7 : 0.3;
  if (letters >= minLetters && ratio > maxRatio) {
    out.push(
      finding(
        "caps-ratio",
        "warning",
        location,
        isShort ? text : `${Math.round(ratio * 100)}% capitals`,
        `Much of the ${where} is in capitals. Use normal sentence case.`,
      ),
    );
  } else {
    const shouted = [...new Set(shoutedWords(text))];
    if (shouted.length >= (isShort ? 1 : 3)) {
      out.push(
        finding(
          "caps-words",
          "warning",
          location,
          shouted.slice(0, 5).join(", "),
          `Words in capitals look like shouting to spam filters. Write ${shouted.length === 1 ? "it" : "them"} in normal case.`,
        ),
      );
    }
  }

  // Repeated punctuation: !!, ??, ?!?, $$
  const seen = new Set<string>();
  for (const m of wording(text).matchAll(/[!?]{3,}|!{2,}|\?{2,}|\${2,}/g)) {
    const key = m[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      finding("repeated-punctuation", "warning", location, key, "Use a single ! or ? - repeated punctuation is a common spam signal."),
    );
  }

  // Suspect phrases.
  const plain = wording(text);
  for (const { phrase, re } of PHRASE_RES) {
    const m = re.exec(plain);
    if (!m) continue;
    out.push(finding("suspect-phrase", "warning", location, m[0], PHRASE_SUGGESTIONS[phrase] ?? DEFAULT_PHRASE_SUGGESTION));
  }
}

function hasUnsubscribeTag(html: string): boolean {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  return /\{\{\s*unsubscribe_url\s*(?:\|[^}]*)?\}\}/i.test(withoutComments);
}

function checkBody(html: string, out: SpamFinding[]): void {
  const text = visibleText(html);
  checkWording(text, "body", out);

  const images = findImages(html).filter((img) => !img.tiny);
  const words = (wording(text).match(/[\p{L}\p{N}]+/gu) ?? []).length;
  if (images.length > 0 && (words < 25 || words / images.length < 15)) {
    out.push(
      finding(
        "image-heavy",
        "warning",
        "body",
        `${images.length} image${images.length === 1 ? "" : "s"}, ${words} word${words === 1 ? "" : "s"}`,
        "The email is mostly images. Add some real text - many inboxes hide images and filters distrust image-only emails.",
      ),
    );
  }

  const noAlt = images.filter((img) => img.alt === null);
  if (noAlt.length > 0) {
    const name = noAlt[0].src.split(/[/?#]/).filter(Boolean).pop() ?? "image";
    out.push(
      finding(
        "missing-alt",
        "warning",
        "body",
        noAlt.length === 1 ? shorten(name, 40) : `${noAlt.length} images`,
        "Add alt text (a short description) to every image - it shows when images are blocked.",
      ),
    );
  }

  checkShorteners(findUrls(html), "body", out);

  if (stripInvisibleMarkup(html).trim() && !hasUnsubscribeTag(html)) {
    out.push(
      finding(
        "no-unsubscribe",
        "info",
        "body",
        "No unsubscribe link",
        "An unsubscribe link is added at the bottom automatically. Add {{unsubscribe_url}} yourself to choose where it goes.",
      ),
    );
  }
}

function checkShorteners(urls: string[], location: SpamLocation, out: SpamFinding[]): void {
  const seen = new Set<string>();
  for (const url of urls) {
    const host = hostOf(url);
    if (!host || seen.has(host)) continue;
    if (LINK_SHORTENERS.some((s) => host === s || host.endsWith(`.${s}`))) {
      seen.add(host);
      out.push(
        finding("link-shortener", "warning", location, host, "Link to the full web address instead of a short link - filters can't see where short links go."),
      );
    }
  }
}

/** Run every rule. Findings are ordered subject, preview text, body, plain text. */
export function checkContent(input: SpamCheckInput): SpamFinding[] {
  const out: SpamFinding[] = [];
  const subject = input.subject ?? "";

  if (input.subject !== undefined) {
    if (!subject.trim()) {
      out.push(finding("empty-subject", "warning", "subject", "No subject", "Add a subject - emails without one are often treated as spam."));
    } else if (subject.trim().length > LONG_SUBJECT_CHARS) {
      out.push(
        finding(
          "long-subject",
          "warning",
          "subject",
          `${subject.trim().length} characters`,
          `Keep the subject under ${LONG_SUBJECT_CHARS} characters - longer ones get cut off, especially on phones.`,
        ),
      );
    }
    checkWording(subject, "subject", out);
  }

  if (input.preheader) checkWording(input.preheader, "preheader", out);
  if (input.html) checkBody(input.html, out);
  if (input.text) {
    checkWording(input.text, "text", out);
    checkShorteners(urlsInText(input.text), "text", out);
  }

  // The same problem can't be listed twice.
  const unique = new Map<string, SpamFinding>();
  for (const f of out) if (!unique.has(f.id)) unique.set(f.id, f);
  return [...unique.values()];
}

/**
 * Short, stable hash of content (FNV-1a, 52 bits, base 36). Same result in
 * the browser and on the server; used to tie spam-check results and test
 * sends to the exact content they were made from.
 */
export function contentHash(input: SpamCheckInput): string {
  const source = JSON.stringify([input.subject ?? "", input.preheader ?? "", input.html ?? "", input.text ?? ""]);
  // Two 32-bit FNV-1a lanes with different offsets, combined.
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 0x3c6ef372) >>> 0;
  }
  return a.toString(36).padStart(7, "0") + (b & 0xfffff).toString(36).padStart(4, "0");
}
