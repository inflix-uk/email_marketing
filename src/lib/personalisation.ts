import { extractMergeTags, renderSubject, SAMPLE_CONTACT, type MergeContact } from "@/lib/render";
import { isBuiltInMergeTag } from "@/lib/templates/merge-tags";

// The "Insert personalisation" menu for subject lines and preview text, and the
// example shown under those fields. Client-safe: no DB, no Node APIs.

export interface PersonalisationOption {
  /** What gets inserted, e.g. "{{first_name | there}}". */
  tag: string;
  label: string;
  /** "contact" = built in, "field" = a custom field from imported contacts. */
  group: "contact" | "field";
}

/** Built-in choices. Names get a friendly fallback so "Hi {{first_name | there}}" never reads "Hi ,". */
const BUILT_IN: PersonalisationOption[] = [
  { tag: "{{first_name | there}}", label: "First name", group: "contact" },
  { tag: "{{last_name}}", label: "Last name", group: "contact" },
  { tag: "{{full_name | there}}", label: "Full name", group: "contact" },
  { tag: "{{email}}", label: "Email", group: "contact" },
];

const TAG_KEY_RE = /^[a-zA-Z0-9_.-]+$/;

/** "home_city" -> "Home city". */
export function fieldLabel(key: string): string {
  const words = key.replace(/[_.-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** Built-in tags first, then the custom fields contacts have (e.g. country, company). */
export function personalisationOptions(fieldKeys: readonly string[] = []): PersonalisationOption[] {
  const seen = new Set<string>();
  const fields: PersonalisationOption[] = [];
  for (const key of fieldKeys) {
    // Only keys a merge tag can name; skip duplicates.
    if (!TAG_KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    fields.push({ tag: `{{fields.${key}}}`, label: fieldLabel(key), group: "field" });
  }
  fields.sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  return [...BUILT_IN, ...fields];
}

/**
 * Where an inserted tag goes: at the caret (replacing a selection), with a
 * space added where it would otherwise stick to the word before or after.
 * Same shape as the editor's TextEdit, so it can be applied to an input.
 */
export function tagInsertion(
  value: string,
  tag: string,
  start = value.length,
  end = start,
): { from: number; to: number; text: string; selectionStart: number; selectionEnd: number } {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  const before = value.slice(0, from);
  const after = value.slice(to);
  const text = (before && !/\s$/.test(before) ? " " : "") + tag + (after && /^[^\s,.!?;:)]/.test(after) ? " " : "");
  const caret = from + text.length;
  return { from, to, text, selectionStart: caret, selectionEnd: caret };
}

const EXAMPLE_FIELDS: Record<string, string> = {
  country: "United Kingdom",
  city: "London",
  company: "Acme Ltd",
};

function exampleContact(text: string): MergeContact {
  const fields: Record<string, string> = { ...SAMPLE_CONTACT.fields };
  for (const tag of extractMergeTags(text)) {
    if (isBuiltInMergeTag(tag)) continue;
    const key = tag.replace(/^fields\./, "");
    if (!fields[key]) fields[key] = EXAMPLE_FIELDS[key.toLowerCase()] ?? `[${fieldLabel(key).toLowerCase()}]`;
  }
  return { ...SAMPLE_CONTACT, fields };
}

const EMPTY_CONTACT: MergeContact = { email: "", firstName: null, lastName: null, fields: {} };

/**
 * What a subject (or preview text) looks like in the inbox, for the hint under
 * the field: filled in for an example contact, and for one without a name
 * (null when that's the same). null when the text has no personalisation.
 */
export function personalisationExample(text: string): { filled: string; empty: string | null } | null {
  if (extractMergeTags(text).length === 0) return null;
  const filled = renderSubject(text, { unsubscribeUrl: "", contact: exampleContact(text) });
  const empty = renderSubject(text, { unsubscribeUrl: "", contact: EMPTY_CONTACT });
  return { filled, empty: empty !== filled ? empty : null };
}
