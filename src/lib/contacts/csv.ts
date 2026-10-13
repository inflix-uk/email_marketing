import Papa from "papaparse";
import type { Contact } from "@/db/schema";

export type ExportContact = Pick<Contact, "email" | "firstName" | "lastName" | "status" | "createdAt" | "fields"> & {
  tags?: string[] | null;
};

/** Byte-order mark: tells Excel the file is UTF-8. */
const BOM = String.fromCharCode(0xfeff);

const BASE_COLUMNS = ["email", "first_name", "last_name", "status", "created_at", "tags"] as const;

const CSV_OPTIONS = { escapeFormulae: true, newline: "\r\n" } as const;

/** Custom field keys in column order (alphabetical, de-duplicated). */
export function sortFieldKeys(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort((a, b) => a.localeCompare(b));
}

/**
 * BOM + header line: the standard columns plus one column per custom field
 * key. A custom field called e.g. "status" is renamed so it doesn't clash
 * with the real column.
 */
export function csvHeader(fieldKeys: string[]): string {
  const fieldHeaders = fieldKeys.map((k) => ((BASE_COLUMNS as readonly string[]).includes(k) ? `field_${k}` : k));
  return `${BOM}${Papa.unparse([[...BASE_COLUMNS, ...fieldHeaders]], CSV_OPTIONS)}\r\n`;
}

/**
 * CSV lines (each ending in CRLF) for a batch of contacts, in the columns of
 * `csvHeader(fieldKeys)`. Formula-like cells are escaped so the file is safe
 * to open in Excel. Called batch by batch when streaming an export.
 */
export function csvRows(contacts: ExportContact[], fieldKeys: string[]): string {
  if (contacts.length === 0) return "";
  const rows = contacts.map((c) => [
    c.email,
    c.firstName ?? "",
    c.lastName ?? "",
    c.status,
    c.createdAt.toISOString(),
    // Comma-separated, so the column can be imported again as "Tags".
    (c.tags ?? []).join(", "),
    ...fieldKeys.map((k) => c.fields?.[k] ?? ""),
  ]);
  return `${Papa.unparse(rows, CSV_OPTIONS)}\r\n`;
}

/** Contacts as one CSV string (header + rows); the export route streams the same output. */
export function contactsToCsv(contacts: ExportContact[]): string {
  const fieldKeys = sortFieldKeys(contacts.flatMap((c) => Object.keys(c.fields ?? {})));
  return csvHeader(fieldKeys) + csvRows(contacts, fieldKeys);
}

/** "contacts-2026-09-29.csv", or "newsletter-contacts-2026-09-29.csv" for a list. */
export function exportFileName(listName?: string | null, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const slug = (listName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${slug ? `${slug}-` : ""}contacts-${date}.csv`;
}
