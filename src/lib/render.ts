import type { Contact } from "@/db/schema";

// Merge-tag rendering shared by template previews, test sends and the worker.
//
// Syntax:  {{first_name}}   {{ first_name | there }}   {{fields.company}}   {{company}}
// The part after "|" is a fallback used when the value is empty.

export type MergeContact = Pick<Contact, "email" | "firstName" | "lastName" | "fields">;

export interface MergeData {
  contact: MergeContact;
  unsubscribeUrl: string;
  /** Postal address for {{company_address}} (from settings). */
  companyAddress?: string;
  /** Additional variables, e.g. { campaign_name: "Spring sale" }. */
  extra?: Record<string, string>;
}

/** Built-in tags, used by the editor's "insert variable" menu. */
export const MERGE_TAGS: { tag: string; label: string }[] = [
  { tag: "first_name", label: "First name" },
  { tag: "last_name", label: "Last name" },
  { tag: "full_name", label: "Full name" },
  { tag: "email", label: "Email address" },
  { tag: "unsubscribe_url", label: "Unsubscribe link" },
  { tag: "company_address", label: "Company address" },
];

/** A fake contact for previews. */
export const SAMPLE_CONTACT: MergeContact = {
  email: "jane.doe@example.com",
  firstName: "Jane",
  lastName: "Doe",
  fields: { company: "Acme Ltd", city: "London" },
};

const TAG_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

export function buildVariables(data: MergeData): Record<string, string> {
  const { contact } = data;
  const first = contact.firstName?.trim() ?? "";
  const last = contact.lastName?.trim() ?? "";
  // Null prototype: a tag like {{constructor}} or {{__proto__}} must not
  // resolve to an Object.prototype member.
  const vars: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(contact.fields ?? {})) {
    const v = value == null ? "" : String(value);
    vars[key] = v;
    vars[`fields.${key}`] = v;
  }
  Object.assign(vars, {
    email: contact.email,
    first_name: first,
    last_name: last,
    full_name: [first, last].filter(Boolean).join(" "),
    unsubscribe_url: data.unsubscribeUrl,
    company_address: data.companyAddress ?? "",
    ...data.extra,
  });
  return vars;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replace merge tags in `input`. Use `escape: true` for HTML bodies and
 * `escape: false` for subjects / plain text.
 */
export function renderMergeTags(
  input: string,
  data: MergeData,
  opts: { escape?: boolean } = {},
): string {
  const vars = buildVariables(data);
  return input.replace(TAG_RE, (_match, key: string, fallback?: string) => {
    const lookup = vars[key] ?? vars[key.toLowerCase()] ?? "";
    const value = lookup !== "" ? lookup : (fallback ?? "");
    return opts.escape ? escapeHtml(value) : value;
  });
}

/** Unique tag names used in a template (without braces). */
export function extractMergeTags(input: string): string[] {
  const found = new Set<string>();
  for (const m of input.matchAll(TAG_RE)) found.add(m[1]);
  return [...found];
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  pound: "£", euro: "€", copy: "©", reg: "®", trade: "™", middot: "·", bull: "•",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

// Single pass, so "&amp;lt;" correctly becomes "&lt;" rather than "<".
function decodeEntity(entity: string, body: string): string {
  if (body[0] === "#") {
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  }
  return Object.hasOwn(NAMED_ENTITIES, body.toLowerCase()) ? NAMED_ENTITIES[body.toLowerCase()] : entity;
}

/** Plain-text alternative for multipart emails. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      return label && label !== href ? `${label} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, decodeEntity)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
