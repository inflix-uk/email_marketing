import { z } from "zod";
import { isValidEmail, normalizeEmail } from "../utils";

// Pure validation helpers shared by the contact forms (client + server), the
// CSV importer and the "paste emails into a list" form. No DB access here.

/** Merge tags that always win over a custom field with the same name. */
export const RESERVED_FIELD_KEYS = [
  "email",
  "first_name",
  "last_name",
  "full_name",
  "unsubscribe_url",
  "company_address",
] as const;

const FIELD_KEY_RE = /^[a-zA-Z0-9_]+$/;
export const MAX_FIELD_KEY_LENGTH = 50;
export const MAX_FIELD_VALUE_LENGTH = 1000;

/** Why `key` can't be used as a custom field name, or null when it's fine. */
export function fieldKeyError(key: string): string | null {
  if (!key) return "Give this field a name.";
  if (key.length > MAX_FIELD_KEY_LENGTH) return `Field names can be at most ${MAX_FIELD_KEY_LENGTH} characters.`;
  if (!FIELD_KEY_RE.test(key)) {
    return `"${key}" isn't a valid field name - use letters, numbers and underscores only.`;
  }
  if ((RESERVED_FIELD_KEYS as readonly string[]).includes(key.toLowerCase())) {
    return `"${key}" is a built-in merge tag - pick another field name.`;
  }
  return null;
}

/** "Company Name" -> "company_name", "E-mail (work)" -> "e_mail_work". */
export function slugifyFieldKey(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // drop accents: "Café" -> "Cafe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_FIELD_KEY_LENGTH)
    .replace(/_+$/, "");
  return slug || "field";
}

// --- Contact form -------------------------------------------------------------

const optionalName = z
  .string()
  .trim()
  .max(100, "Keep this under 100 characters.")
  .transform((v) => v || null);

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .max(254, "That email address is too long.")
  .refine(isValidEmail, "Enter a valid email address, like name@example.com.")
  .transform(normalizeEmail);

const customFieldRows = z
  .array(z.object({ key: z.string().trim(), value: z.string().trim() }))
  .transform((rows, ctx) => {
    const fields: Record<string, string> = {};
    for (const { key, value } of rows) {
      if (!key && !value) continue; // blank row
      const problem = fieldKeyError(key);
      if (problem) {
        ctx.addIssue({ code: "custom", message: problem });
        return z.NEVER;
      }
      if (key in fields) {
        ctx.addIssue({ code: "custom", message: `The field "${key}" is listed twice.` });
        return z.NEVER;
      }
      if (value.length > MAX_FIELD_VALUE_LENGTH) {
        ctx.addIssue({ code: "custom", message: `The value of "${key}" is too long.` });
        return z.NEVER;
      }
      // A named field with no value is simply not stored.
      if (value) fields[key] = value;
    }
    return fields;
  });

export const contactInputSchema = z.object({
  email: emailSchema,
  firstName: optionalName,
  lastName: optionalName,
  fields: customFieldRows,
  listIds: z.array(z.string().min(1)).transform((ids) => [...new Set(ids)]),
});

export type ContactInput = z.output<typeof contactInputSchema>;
export type ContactFieldErrors = Partial<Record<"email" | "firstName" | "lastName" | "fields" | "listIds", string>>;

/** Read the contact form's FormData into the shape `contactInputSchema` expects. */
export function contactFormValues(formData: FormData) {
  const keys = formData.getAll("fieldKey").map(String);
  const values = formData.getAll("fieldValue").map(String);
  return {
    email: String(formData.get("email") ?? ""),
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    fields: keys.map((key, i) => ({ key, value: values[i] ?? "" })),
    listIds: formData.getAll("listIds").map(String),
  };
}

/** First message per top-level field, for showing next to each input. */
export function firstErrors<K extends string>(error: z.ZodError): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form") as K;
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

// --- Lists ------------------------------------------------------------------

export const listInputSchema = z.object({
  name: z.string().trim().min(1, "Give the list a name.").max(100, "Keep the name under 100 characters."),
  description: z
    .string()
    .trim()
    .max(500, "Keep the description under 500 characters.")
    .transform((v) => v || null),
});

// --- Pasted email addresses -------------------------------------------------------

export interface ParsedEmailList {
  /** Valid, normalised, de-duplicated addresses in the order they were pasted. */
  emails: string[];
  /** Entries that don't look like an email address (as typed). */
  invalid: string[];
  /** How many valid entries were repeats. */
  duplicates: number;
}

/**
 * Parse a pasted block of addresses: one per line, or separated by commas,
 * semicolons or spaces. `Jane Doe <jane@example.com>` is accepted too.
 */
export function parseEmailList(text: string): ParsedEmailList {
  const seen = new Set<string>();
  const invalid: string[] = [];
  let duplicates = 0;

  for (const part of text.split(/[\n\r,;]+/)) {
    const entry = part.trim();
    if (!entry) continue;
    const bracketed = entry.match(/<([^<>]+)>/);
    const candidates = bracketed ? [bracketed[1]] : entry.split(/\s+/);
    for (const raw of candidates) {
      const cleaned = raw.trim().replace(/^mailto:/i, "");
      if (!cleaned) continue;
      if (!isValidEmail(cleaned)) {
        invalid.push(bracketed ? entry : cleaned);
        continue;
      }
      const email = normalizeEmail(cleaned);
      if (seen.has(email)) duplicates++;
      else seen.add(email);
    }
  }
  return { emails: [...seen], invalid, duplicates };
}
