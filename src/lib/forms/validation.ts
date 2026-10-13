import { z } from "zod";
import type { FormField } from "@/db/schema";
import { splitTags, tagError, uniqueTags } from "@/lib/contacts/tags";
import { fieldKeyError } from "@/lib/contacts/validation";
import { isValidEmail, normalizeEmail } from "@/lib/utils";

// Pure validation for sign-up forms: the admin editor's input and the public
// submissions. No DB access here.

/** Hidden input real people never fill in; bots that fill every field do. */
export const HONEYPOT_FIELD = "hp_website";

export const BUILT_IN_FIELDS = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
] as const;

const BUILT_IN_KEYS: readonly string[] = BUILT_IN_FIELDS.map((f) => f.key);

export const MAX_FORM_FIELDS = 10;
export const MAX_TAGS = 20;

export const FORM_DEFAULTS = {
  title: "Subscribe to our newsletter",
  buttonText: "Subscribe",
  successMessage: "Thanks for subscribing!",
};

/** Normalised form tags (see contacts/tags.ts), or a message when they can't be saved. */
export function parseFormTags(input: string | readonly string[]): { tags: string[] } | { error: string } {
  const tags = typeof input === "string" ? splitTags(input) : uniqueTags(input);
  if (tags.length > MAX_TAGS) return { error: `Use at most ${MAX_TAGS} tags.` };
  for (const tag of tags) {
    const problem = tagError(tag);
    if (problem) return { error: `"${tag.slice(0, 30)}": ${problem}` };
  }
  return { tags };
}

// --- Admin editor ---------------------------------------------------------------

/** Why `key` can't be a form field, or null when it's fine. */
export function formFieldKeyError(key: string): string | null {
  if (BUILT_IN_KEYS.includes(key)) return null;
  if (key === HONEYPOT_FIELD) return `"${key}" is reserved - pick another field name.`;
  return fieldKeyError(key);
}

const fieldsSchema = z
  .array(z.object({ key: z.string().trim(), label: z.string().trim(), required: z.boolean() }))
  .max(MAX_FORM_FIELDS, `A form can have at most ${MAX_FORM_FIELDS} extra fields.`)
  .transform((rows, ctx) => {
    const seen = new Set<string>();
    const fields: FormField[] = [];
    for (const row of rows) {
      const problem = formFieldKeyError(row.key);
      if (problem) {
        ctx.addIssue({ code: "custom", message: problem });
        return z.NEVER;
      }
      if (seen.has(row.key.toLowerCase())) {
        ctx.addIssue({ code: "custom", message: `The field "${row.key}" is listed twice.` });
        return z.NEVER;
      }
      seen.add(row.key.toLowerCase());
      if (!row.label) {
        ctx.addIssue({ code: "custom", message: `Give the field "${row.key}" a label.` });
        return z.NEVER;
      }
      if (row.label.length > 60) {
        ctx.addIssue({ code: "custom", message: "Keep field labels under 60 characters." });
        return z.NEVER;
      }
      fields.push({ key: row.key, label: row.label, required: row.required });
    }
    return fields;
  });

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const formInputSchema = z.object({
  name: z.string().trim().min(1, "Give the form a name.").max(100, "Keep the name under 100 characters."),
  title: z.string().trim().min(1, "Add a title.").max(120, "Keep the title under 120 characters."),
  description: z
    .string()
    .trim()
    .max(500, "Keep the description under 500 characters.")
    .transform((v) => v || null),
  buttonText: z.string().trim().min(1, "Add the button text.").max(40, "Keep the button text under 40 characters."),
  fields: fieldsSchema,
  listIds: z.array(z.string().min(1).max(64)).transform((ids) => [...new Set(ids)]),
  tags: z.string().max(2000).transform((value, ctx) => {
    const parsed = parseFormTags(value);
    if ("error" in parsed) {
      ctx.addIssue({ code: "custom", message: parsed.error });
      return z.NEVER;
    }
    return parsed.tags;
  }),
  doubleOptIn: z.boolean(),
  successMessage: z.string().trim().min(1, "Add a success message.").max(300, "Keep the message under 300 characters."),
  redirectUrl: z
    .string()
    .trim()
    .max(500, "That URL is too long.")
    .refine((v) => !v || isHttpUrl(v), "Enter a full URL starting with https://")
    .transform((v) => v || null),
  active: z.boolean(),
});

export type FormInput = z.output<typeof formInputSchema>;
export type FormFieldErrors = Partial<Record<keyof FormInput, string>>;

// --- Public submissions -----------------------------------------------------------

export const MAX_EMAIL_LENGTH = 254;
export const MAX_NAME_LENGTH = 100;
export const MAX_VALUE_LENGTH = 500;

export interface Submission {
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** Custom field values (only keys the form defines; empty ones left out). */
  fields: Record<string, string>;
}

export type SubmissionResult =
  | { ok: true; submission: Submission }
  /** The honeypot was filled in: pretend it worked, store nothing. */
  | { ok: false; bot: true }
  | { ok: false; bot: false; code: "invalid_email" | "missing_field" | "too_long"; message: string };

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Validate one submission against the form's fields. `raw` is the posted
 * key/value data (form-encoded or JSON). Keys the form doesn't define are ignored.
 */
export function parseSubmission(fields: readonly FormField[], raw: Record<string, unknown>): SubmissionResult {
  if (text(raw[HONEYPOT_FIELD])) return { ok: false, bot: true };

  const email = text(raw.email);
  if (!email || email.length > MAX_EMAIL_LENGTH || !isValidEmail(email)) {
    return { ok: false, bot: false, code: "invalid_email", message: "Enter a valid email address." };
  }

  const submission: Submission = { email: normalizeEmail(email), firstName: null, lastName: null, fields: {} };
  for (const field of fields) {
    const value = text(raw[field.key]);
    if (!value) {
      if (field.required) {
        return { ok: false, bot: false, code: "missing_field", message: `${field.label} is required.` };
      }
      continue;
    }
    const builtIn = BUILT_IN_KEYS.includes(field.key);
    if (value.length > (builtIn ? MAX_NAME_LENGTH : MAX_VALUE_LENGTH)) {
      return { ok: false, bot: false, code: "too_long", message: `${field.label} is too long.` };
    }
    if (field.key === "first_name") submission.firstName = value;
    else if (field.key === "last_name") submission.lastName = value;
    else submission.fields[field.key] = value;
  }
  return { ok: true, submission };
}
