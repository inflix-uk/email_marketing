import Papa from "papaparse";
import { isValidEmail, normalizeEmail } from "../utils";
import { fieldKeyError, slugifyFieldKey } from "./validation";

// Pure CSV-import logic, shared by the browser (preview + column mapping) and
// the server action (which re-parses the file and imports it). The database
// side lives in ./run-import.ts.

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 100_000;
/** How many invalid rows are reported back individually. */
export const MAX_INVALID_EXAMPLES = 20;

export const COLUMN_TARGETS = ["email", "first_name", "last_name", "full_name", "field", "ignore"] as const;
export type ColumnTarget = (typeof COLUMN_TARGETS)[number];

export const COLUMN_TARGET_LABELS: Record<ColumnTarget, string> = {
  email: "Email",
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  field: "Custom field",
  ignore: "Don't import",
};

/** What to do with one CSV column. `mapping[i]` describes column `i`. */
export interface ColumnMapping {
  target: ColumnTarget;
  /** Custom field name, when target is "field". */
  fieldKey?: string;
}

export interface ParsedCsv {
  headers: string[];
  /** Data rows (header excluded). Rows may be shorter or longer than `headers`. */
  rows: string[][];
}

/** Parse CSV text (header row first). Handles BOMs, quoted cells and ; or tab delimiters. */
export function parseCsv(text: string): ParsedCsv {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const result = Papa.parse<string[]>(withoutBom, {
    skipEmptyLines: "greedy",
  });
  const [headerRow = [], ...rows] = result.data;
  const headers = headerRow.map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows };
}

// --- Header auto-detection --------------------------------------------------------

type DetectedTarget = Exclude<ColumnTarget, "ignore">;

/** Known headers, compared after lower-casing and dropping spaces/punctuation. */
const HEADER_ALIASES: [DetectedTarget, string[]][] = [
  ["email", ["email", "emailaddress", "mail", "emailid", "primaryemail", "workemail", "contactemail"]],
  ["first_name", ["firstname", "first", "givenname", "forename", "fname"]],
  ["last_name", ["lastname", "last", "surname", "familyname", "lname"]],
  ["full_name", ["name", "fullname", "contactname", "displayname"]],
];

/** "E-mail Address" -> "emailaddress" */
function compactHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Best guess for a single header, ignoring the other columns. */
export function detectColumnTarget(header: string): DetectedTarget {
  const compact = compactHeader(header);
  for (const [target, aliases] of HEADER_ALIASES) {
    if (aliases.includes(compact)) return target;
  }
  return "field";
}

/**
 * Suggested mapping for a header row: well-known headers become email / names,
 * everything else a custom field named after the header. Only the first email,
 * first-name, etc. column is used; a "Name" column is only split into first and
 * last name when there are no dedicated first/last name columns.
 */
export function suggestMapping(headers: string[]): ColumnMapping[] {
  const detected = headers.map(detectColumnTarget);
  const hasSplitNames = detected.includes("first_name") || detected.includes("last_name");
  const taken = new Set<ColumnTarget>();
  const usedKeys = new Set<string>();

  return headers.map((header, i) => {
    let target: ColumnTarget = detected[i];
    if (target === "full_name" && hasSplitNames) target = "field";
    if (target !== "field") {
      if (!taken.has(target)) {
        taken.add(target);
        return { target };
      }
      target = "field";
    }
    let key = slugifyFieldKey(header);
    if (fieldKeyError(key)) key = `${key}_field`; // e.g. a second "Email" column
    const base = key;
    for (let n = 2; usedKeys.has(key); n++) key = `${base}_${n}`;
    usedKeys.add(key);
    return { target: "field", fieldKey: key };
  });
}

/** Problem with a mapping that must be fixed before importing, or null. */
export function validateMapping(mapping: ColumnMapping[], columnCount: number): string | null {
  if (mapping.length !== columnCount) return "The column mapping doesn't match the file - please choose the file again.";

  const count = (t: ColumnTarget) => mapping.filter((m) => m.target === t).length;
  if (count("email") === 0) return "Choose which column contains the email address.";
  for (const t of ["email", "first_name", "last_name", "full_name"] as const) {
    if (count(t) > 1) return `Only one column can be imported as ${COLUMN_TARGET_LABELS[t]}.`;
  }

  const keys = new Set<string>();
  for (const m of mapping) {
    if (m.target !== "field") continue;
    const key = m.fieldKey?.trim() ?? "";
    const problem = fieldKeyError(key);
    if (problem) return problem;
    if (keys.has(key)) return `Two columns are imported into the same custom field "${key}".`;
    keys.add(key);
  }
  return null;
}

// --- Row mapping --------------------------------------------------------------------

/** "Jane Doe" -> Jane / Doe, "Doe, Jane" -> Jane / Doe, "Cher" -> Cher. */
export function splitFullName(name: string): { firstName?: string; lastName?: string } {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) return {};
  const comma = clean.indexOf(",");
  if (comma !== -1) {
    const last = clean.slice(0, comma).trim();
    const first = clean.slice(comma + 1).trim();
    return { firstName: first || undefined, lastName: last || undefined };
  }
  const space = clean.indexOf(" ");
  if (space === -1) return { firstName: clean };
  return { firstName: clean.slice(0, space), lastName: clean.slice(space + 1) };
}

export interface ImportContact {
  /** Normalised (trimmed, lower-cased). */
  email: string;
  firstName?: string;
  lastName?: string;
  /** Non-empty custom field values only: empty cells never erase data. */
  fields: Record<string, string>;
}

export interface InvalidRow {
  /** Spreadsheet-style row number: the header is row 1. */
  row: number;
  value: string;
  reason: string;
}

export interface MappedRows {
  /** One entry per unique email address. */
  contacts: ImportContact[];
  /** The first MAX_INVALID_EXAMPLES invalid rows. */
  invalid: InvalidRow[];
  invalidCount: number;
  /** Rows whose email already appeared earlier in the file (merged). */
  duplicateCount: number;
  totalRows: number;
}

/**
 * Turn parsed rows into contacts: validates and lower-cases emails, splits
 * full names, collects custom fields and merges rows that share an email
 * (later non-empty values win). Assumes `validateMapping` passed.
 */
export function mapRows(rows: string[][], mapping: ColumnMapping[]): MappedRows {
  const emailCol = mapping.findIndex((m) => m.target === "email");
  const byEmail = new Map<string, ImportContact>();
  const invalid: InvalidRow[] = [];
  let invalidCount = 0;
  let duplicateCount = 0;

  rows.forEach((cells, index) => {
    const rowNumber = index + 2;
    const rawEmail = (cells[emailCol] ?? "").trim();
    if (!rawEmail || !isValidEmail(rawEmail)) {
      invalidCount++;
      if (invalid.length < MAX_INVALID_EXAMPLES) {
        invalid.push({
          row: rowNumber,
          value: rawEmail,
          reason: rawEmail ? "Not a valid email address" : "Email is missing",
        });
      }
      return;
    }

    const contact: ImportContact = { email: normalizeEmail(rawEmail), fields: {} };
    let fullName: { firstName?: string; lastName?: string } = {};
    mapping.forEach((m, col) => {
      const value = (cells[col] ?? "").trim();
      if (!value) return;
      switch (m.target) {
        case "first_name":
          contact.firstName = value;
          break;
        case "last_name":
          contact.lastName = value;
          break;
        case "full_name":
          fullName = splitFullName(value);
          break;
        case "field":
          contact.fields[m.fieldKey!.trim()] = value;
          break;
      }
    });
    contact.firstName ??= fullName.firstName;
    contact.lastName ??= fullName.lastName;

    const earlier = byEmail.get(contact.email);
    if (!earlier) {
      byEmail.set(contact.email, contact);
      return;
    }
    duplicateCount++;
    earlier.firstName = contact.firstName ?? earlier.firstName;
    earlier.lastName = contact.lastName ?? earlier.lastName;
    Object.assign(earlier.fields, contact.fields);
  });

  return {
    contacts: [...byEmail.values()],
    invalid,
    invalidCount,
    duplicateCount,
    totalRows: rows.length,
  };
}
