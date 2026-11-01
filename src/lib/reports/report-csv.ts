import { METRICS, REPORT_TIMEZONE, formatDay, metricValue, type DateRange, type ReportCounts, type ReportRow } from "./rollup";

// CSV export of the /reports table. Pure: the route only gathers the data.

/** Byte-order mark: tells Excel the file is UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (=, +, -, @,
 * tab, CR at the start) gets a leading apostrophe; cells with a comma, quote
 * or line break are quoted. Numbers are written as they are.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== value ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: (string | number | null | undefined)[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

/** Rates as percentages with 2 decimals; N/A stays empty-safe as "N/A". */
function metricCells(c: ReportCounts): (string | number)[] {
  return METRICS.map((m) => {
    const v = metricValue(c, m.key);
    if (v === null) return "N/A";
    return m.kind === "rate" ? Math.round(v * 10000) / 100 : v;
  });
}

export interface ReportCsvInput {
  /** e.g. "All campaigns" or "List: Newsletter". */
  scope: string;
  range: DateRange;
  groupLabel: string;
  generatedAt: Date;
  rows: ReportRow[];
  total: ReportCounts;
}

const generatedFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: REPORT_TIMEZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

/** The whole CSV: a few header rows (scope, dates, timezone, generated), then the table and a total row. */
export function reportToCsv(input: ReportCsvInput): string {
  const head = [input.groupLabel, ...METRICS.map((m) => (m.kind === "rate" ? `${m.label} (%)` : m.label))];
  return (
    BOM +
    csvLine(["Report", "Campaign results"]) +
    csvLine(["Scope", input.scope]) +
    csvLine(["Dates", `${formatDay(input.range.from)} to ${formatDay(input.range.to)}`]) +
    csvLine(["Timezone", REPORT_TIMEZONE]) +
    csvLine(["Generated", generatedFmt.format(input.generatedAt)]) +
    "\r\n" +
    csvLine(head) +
    input.rows.map((r) => csvLine([r.label, ...metricCells(r.counts)])).join("") +
    csvLine(["Total", ...metricCells(input.total)])
  );
}

/** "campaign-results-2026-10-01-to-2026-10-27.csv" */
export function reportFileName(range: DateRange): string {
  return `campaign-results-${range.from}-to-${range.to}.csv`;
}
