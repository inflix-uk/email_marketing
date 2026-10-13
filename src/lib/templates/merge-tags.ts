import { MERGE_TAGS } from "@/lib/render";

// Helpers for working with merge tags in the template editor and linter.
// Client-safe: no DB, no Node APIs.

/**
 * Same syntax as `renderMergeTags` in @/lib/render:
 *   {{first_name}}   {{ first_name | there }}   {{fields.company}}
 */
const TAG_SOURCE = String.raw`\{\{\s*([a-zA-Z0-9_.-]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}`;

export interface MergeTagUsage {
  /** The full tag as written, e.g. "{{ first_name | there }}". */
  raw: string;
  key: string;
  /** null when the tag has no "|" part; "" for an explicit empty fallback. */
  fallback: string | null;
  index: number;
}

export function findMergeTags(input: string): MergeTagUsage[] {
  const re = new RegExp(TAG_SOURCE, "g");
  return [...input.matchAll(re)].map((m) => ({
    raw: m[0],
    key: m[1],
    fallback: m[2] ?? null,
    index: m.index ?? 0,
  }));
}

/**
 * Text that starts like a merge tag ("{{") but won't be replaced when
 * sending, e.g. "{{first name}}" or "{{first_name}". Returned as written.
 */
export function findMalformedMergeTags(input: string): string[] {
  const sticky = new RegExp(TAG_SOURCE, "y");
  const found: string[] = [];
  let i = input.indexOf("{{");
  while (i !== -1) {
    sticky.lastIndex = i;
    if (sticky.test(input)) {
      i = input.indexOf("{{", sticky.lastIndex);
      continue;
    }
    const nextOpen = input.indexOf("{{", i + 2);
    const segment = input.slice(i, nextOpen === -1 ? undefined : nextOpen);
    // Up to the closing brace(s) if there are any, else up to whitespace / "<".
    const snippet = (/^\{\{[^}]*\}\}?/.exec(segment) ?? /^\{\{[^\s<]*/.exec(segment))![0];
    found.push(snippet.length > 40 ? `${snippet.slice(0, 40)}…` : snippet);
    i = nextOpen;
  }
  return found;
}

const BUILT_IN_KEYS = new Set(MERGE_TAGS.map((t) => t.tag));

/** Built-in tags always have a value (they're case-insensitive when rendered). */
export function isBuiltInMergeTag(key: string): boolean {
  return BUILT_IN_KEYS.has(key.toLowerCase());
}

const ALIASES: Record<string, string> = {
  fname: "first_name",
  firstname: "first_name",
  lname: "last_name",
  lastname: "last_name",
  surname: "last_name",
  name: "full_name",
  fullname: "full_name",
  emailaddress: "email",
  unsubscribe: "unsubscribe_url",
  unsubscribelink: "unsubscribe_url",
  unsubscribeurl: "unsubscribe_url",
  unsubscribe_link: "unsubscribe_url",
  address: "company_address",
  companyaddress: "company_address",
};

/** "firstname" -> "first_name": a likely intended built-in tag, if any. */
export function suggestBuiltInMergeTag(key: string): string | null {
  const lower = key.toLowerCase();
  if (BUILT_IN_KEYS.has(lower)) return null;
  const squashed = lower.replace(/[^a-z0-9]/g, "");
  if (ALIASES[lower]) return ALIASES[lower];
  if (ALIASES[squashed]) return ALIASES[squashed];
  for (const tag of BUILT_IN_KEYS) {
    if (tag.replace(/[^a-z0-9]/g, "") === squashed) return tag;
  }
  return null;
}

/** "{{first_name}}" or "{{first_name | there}}". Braces are stripped from the fallback. */
export function formatMergeTag(key: string, fallback?: string | null): string {
  const fb = (fallback ?? "").replace(/[{}]/g, "").trim();
  return fb ? `{{${key} | ${fb}}}` : `{{${key}}}`;
}

/**
 * Turn free-form input into a custom-field key usable in a tag, e.g.
 * "fields.company" -> "company", "Home city" -> "Home_city". Case is kept so
 * it matches the field name as imported. Returns "" when nothing usable is left.
 */
export function toCustomFieldKey(input: string): string {
  const key = input
    .replace(/[{}]/g, "")
    .trim()
    .replace(/^fields\./i, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .replace(/^\.+|\.+$/g, "");
  return /[a-zA-Z0-9]/.test(key) ? key : "";
}
