import {
  findMalformedMergeTags,
  findMergeTags,
  formatMergeTag,
  isBuiltInMergeTag,
  suggestBuiltInMergeTag,
} from "./merge-tags";

// Static checks for email HTML, shown under the editor. Pure and client-safe.
// Everything is a heuristic (regex, not a full HTML parser): the goal is to
// catch the common mistakes that break emails in real inboxes.

export interface LintIssue {
  level: "error" | "warning";
  message: string;
}

/** Gmail clips emails whose HTML is larger than this (~102 KB). */
export const GMAIL_CLIP_BYTES = 102 * 1024;
/** Warn a little early: sending adds tracking links and a footer. */
const SIZE_WARNING_BYTES = 100 * 1024;

const MAX_LISTED = 3;

export function htmlByteSize(html: string): number {
  return new TextEncoder().encode(html).length;
}

/** 950 -> "950 B", 12345 -> "12.1 KB". */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
}

/** Remove HTML comments, keeping Outlook conditional comments (<!--[if mso]>...). */
function stripComments(html: string): string {
  return html.replace(/<!--(?!\[if)[\s\S]*?-->/g, "");
}

function hasVisibleContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|zwnj|zwj|shy|#160|#xa0|#8203|#8204|#847);/gi, "")
    .trim();
  return text.length > 0;
}

function listed(items: string[]): string {
  const shown = items.slice(0, MAX_LISTED).join(", ");
  return items.length > MAX_LISTED ? `${shown} and ${items.length - MAX_LISTED} more` : shown;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function lintEmailHtml(html: string): LintIssue[] {
  if (!html.trim()) {
    return [{ level: "error", message: "The email is empty. Add some HTML content." }];
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const code = stripComments(html);

  if (!hasVisibleContent(code)) {
    errors.push("The email body has no visible text or images.");
  }

  // --- Unsubscribe link ------------------------------------------------------
  const tags = findMergeTags(code);
  if (!tags.some((t) => t.key.toLowerCase() === "unsubscribe_url")) {
    // Sending adds a footer only when the raw HTML has no {{unsubscribe_url}} at all.
    const onlyInComments = findMergeTags(html).some((t) => t.key === "unsubscribe_url");
    warnings.push(
      onlyInComments
        ? "{{unsubscribe_url}} only appears inside an HTML comment - recipients won't see an unsubscribe link, and no footer will be added. Use it in a visible link."
        : "No {{unsubscribe_url}} link found - an unsubscribe footer will be added automatically when sending.",
    );
  }

  // --- Elements email clients strip or block ---------------------------------
  if (/<script\b/i.test(code)) {
    warnings.push("<script> tags are stripped by email clients - JavaScript never runs in email.");
  }
  if (/<form\b/i.test(code)) {
    warnings.push("<form> elements are blocked or broken in most email clients - link to a web page instead.");
  }
  if (/<iframe\b/i.test(code)) {
    warnings.push("<iframe> embeds are blocked by email clients - link to the content or use an image instead.");
  }

  const stylesheets = [...code.matchAll(/<link\b([^>]*)>/gi)].filter((m) =>
    /\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(m[1]),
  );
  if (stylesheets.length > 0) {
    warnings.push(
      'External stylesheets (<link rel="stylesheet">) are removed by most email clients - use inline styles instead.',
    );
  }

  // --- Images ----------------------------------------------------------------
  const images = [...code.matchAll(/<img\b([^>]*)>/gi)].map((m) => m[1]);
  const missingAlt = images.filter((attrs) => !/(?:^|\s)alt(?:\s*=|\s|\/|$)/i.test(attrs)).length;
  if (missingAlt > 0) {
    warnings.push(
      `${plural(missingAlt, "image is", "images are")} missing alt text - it's shown when images are blocked and read out by screen readers (use alt="" for decorative images).`,
    );
  }
  const inlineImages = images.filter((attrs) => /(?:^|\s)src\s*=\s*["']?\s*data:/i.test(attrs)).length;
  if (inlineImages > 0) {
    warnings.push(
      `${plural(inlineImages, "image is", "images are")} embedded as a data: URI, which Gmail and Outlook block - host images online and link to them.`,
    );
  }

  // --- Size ------------------------------------------------------------------
  const bytes = htmlByteSize(html);
  if (bytes > SIZE_WARNING_BYTES) {
    warnings.push(
      `The HTML is ${formatByteSize(bytes)} - Gmail clips messages over 102 KB, hiding the rest of the email (including the unsubscribe link). Trim it down.`,
    );
  }

  // --- Merge tags ------------------------------------------------------------
  const malformed = [...new Set(findMalformedMergeTags(code))];
  if (malformed.length > 0) {
    warnings.push(
      `${malformed.length === 1 ? "This merge tag isn't valid and will" : "These merge tags aren't valid and will"} appear as-is: ${listed(malformed)}. Tag names can use letters, numbers, "_", "." and "-", e.g. {{first_name}}.`,
    );
  }

  // Custom fields (anything not built-in) may be missing for some contacts.
  // key -> true when at least one use has no fallback.
  const custom = new Map<string, boolean>();
  for (const tag of tags) {
    if (isBuiltInMergeTag(tag.key)) continue;
    custom.set(tag.key, (custom.get(tag.key) ?? false) || tag.fallback === null);
  }
  for (const [key, missingFallback] of custom) {
    const suggestion = suggestBuiltInMergeTag(key);
    if (suggestion) {
      warnings.push(
        `{{${key}}} isn't a built-in variable - did you mean {{${suggestion}}}? As written it only works for contacts with a "${key}" custom field.`,
      );
    } else if (missingFallback) {
      warnings.push(
        `{{${key}}} is a custom field with no fallback - contacts without it will see a blank. Add a fallback, e.g. ${formatMergeTag(key, "there")}.`,
      );
    }
  }

  return [
    ...errors.map((message) => ({ level: "error" as const, message })),
    ...warnings.map((message) => ({ level: "warning" as const, message })),
  ];
}
