// Pure helpers for contact tags (`contact.tags`): free-form labels stored
// lower-cased and trimmed, unique per contact. Safe to import from client
// components, the worker and tests - no DB access here.

export const MAX_TAG_LENGTH = 50;
/** Upper bound for the tags of one contact set through the contact form. */
export const MAX_TAGS_PER_CONTACT = 100;

/** "  VIP  Customer " -> "vip customer". Returns "" when nothing is left. */
export function normalizeTag(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Why `tag` (already normalised) can't be used, or null when it's fine. */
export function tagError(tag: string): string | null {
  if (!tag) return "Type a tag.";
  if (tag.length > MAX_TAG_LENGTH) return `Tags can be at most ${MAX_TAG_LENGTH} characters.`;
  if (/[,;]/.test(tag)) return "Tags can't contain commas or semicolons.";
  return null;
}

/** Normalise a list of tags: lower-case, trim, drop blanks and repeats (order kept). */
export function uniqueTags(tags: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/** Split typed text on commas, semicolons and line breaks into normalised, unique tags (not shortened). */
export function splitTags(text: string): string[] {
  return uniqueTags(text.split(/[,;\n\r]+/));
}

/**
 * Tags from free text such as a CSV cell: like `splitTags`, but over-long
 * tags are cut to MAX_TAG_LENGTH rather than rejected (imports shouldn't fail on them).
 */
export function parseTags(text: string): string[] {
  return uniqueTags(splitTags(text).map((tag) => tag.slice(0, MAX_TAG_LENGTH)));
}

/** Tags in `wanted` that `current` doesn't have yet. */
export function missingTags(current: readonly string[] | null | undefined, wanted: readonly string[]): string[] {
  const have = new Set(current ?? []);
  return wanted.filter((tag) => !have.has(tag));
}
