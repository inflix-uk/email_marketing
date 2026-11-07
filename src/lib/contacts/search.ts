import type { Filter } from "mongodb";
import type { ContactDoc } from "@/db/schema";
import { isValidEmail, normalizeEmail } from "@/lib/utils";

// Pure helpers for the contacts search (the quick search box on /contacts and
// the ?q= table filter). No database access, so they are safe in client
// components and tests.

/** Longest search term we accept (longer input is cut). */
export const MAX_SEARCH_LENGTH = 200;

/** How many matches the quick-search dropdown shows. */
export const QUICK_SEARCH_LIMIT = 8;

/**
 * Custom-field keys that hold a phone number. There is no dedicated phone
 * column: imports store it as a custom field, slugified ("Phone #" -> "phone").
 */
export const PHONE_FIELD_KEYS = [
  "phone",
  "phone_number",
  "phonenumber",
  "mobile",
  "mobile_number",
  "mobile_phone",
  "telephone",
  "tel",
  "cell",
  "contact_number",
  "whatsapp",
] as const;

/** Escape regex metacharacters so user input matches literally in `$regex`. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Trim and cap a raw search term. */
export function cleanSearchTerm(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_SEARCH_LENGTH) : "";
}

/** The normalised address when the term is a complete email address, otherwise null. */
export function exactEmailOf(term: string): string | null {
  const t = term.trim();
  return t && isValidEmail(t) ? normalizeEmail(t) : null;
}

/**
 * Digits of a term that looks like a phone number (only digits, spaces and
 * + - . ( ), with at least 3 digits), otherwise null.
 */
export function phoneDigitsOf(term: string): string | null {
  const t = term.trim();
  if (!/^[\d\s+().-]+$/.test(t)) return null;
  const digits = t.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}

/**
 * Regex for phone digits that ignores the separators people type or store
 * ("07700 900123", "+44 7700-900123"). Only digits go in, so it is safe.
 */
export function phonePattern(digits: string): string {
  return digits.replace(/\D/g, "").split("").join("[^0-9]*");
}

/** Clauses matching a phone-like term in any phone custom field. */
export function phoneClauses(term: string): Filter<ContactDoc>[] {
  const digits = phoneDigitsOf(term);
  if (!digits) return [];
  const regex = { $regex: phonePattern(digits) };
  return PHONE_FIELD_KEYS.map((key) => ({ [`fields.${key}`]: regex }) as Filter<ContactDoc>);
}

/**
 * Index-friendly email prefix match: emails are stored lower-cased, so an
 * anchored, case-sensitive regex on the lower-cased term uses the email index.
 */
export function emailPrefixFilter(term: string): Filter<ContactDoc> {
  return { email: { $regex: `^${escapeRegex(normalizeEmail(term))}` } };
}

/** The first phone-like custom field of a contact, if any. */
export function phoneOf(fields: Record<string, string> | null | undefined): string | null {
  if (!fields) return null;
  for (const key of PHONE_FIELD_KEYS) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
