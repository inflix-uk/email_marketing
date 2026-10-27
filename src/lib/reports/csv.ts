import Papa from "papaparse";

// CSV for report exports. Every cell is a string; cells that a spreadsheet
// would run as a formula (= + - @, tab, CR) get a leading apostrophe.

export type CsvCell = string | number | Date | null | undefined;

/** Byte-order mark: tells Excel the file is UTF-8. */
export const CSV_BOM = String.fromCharCode(0xfeff);

export function csvSafeCell(value: CsvCell): string {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Rows -> CSV text (CRLF line endings, trailing newline). */
export function toCsv(rows: CsvCell[][]): string {
  if (rows.length === 0) return "";
  return `${Papa.unparse(rows.map((r) => r.map(csvSafeCell)), { newline: "\r\n" })}\r\n`;
}

/** "Spring sale!" -> "spring-sale-links-2026-10-13.csv" */
export function csvFileName(name: string, suffix: string, now = new Date()): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${slug || "campaign"}-${suffix}-${now.toISOString().slice(0, 10)}.csv`;
}
