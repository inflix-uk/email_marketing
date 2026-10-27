// Pure math for the cross-campaign report (/reports): date ranges in UK time,
// grouping campaigns into periods, roll-up totals and rates, comparison with
// the previous period. No database access, so it is unit-tested directly.
//
// Rates are always computed from summed numerators / denominators, never by
// averaging per-campaign percentages. A zero denominator gives `null` ("N/A").
// The tiny rate helper below is local on purpose; it can later be swapped for
// the shared formulas in src/lib/reports/metrics.ts.

export const REPORT_TIMEZONE = "Europe/London";

// --- Counts and rates --------------------------------------------------------

/** Summed counts for one campaign, one period, or the whole report. */
export interface ReportCounts {
  campaigns: number;
  /** Sends with status "sent". */
  sent: number;
  /** Sent and not bounced: the denominator of open and click rates. */
  delivered: number;
  /** Unique opens (sends with openedAt). */
  opens: number;
  /** Unique clicks (sends with clickedAt). */
  clicks: number;
  unsubscribes: number;
  bounces: number;
  complaints: number;
}

export function emptyCounts(): ReportCounts {
  return { campaigns: 0, sent: 0, delivered: 0, opens: 0, clicks: 0, unsubscribes: 0, bounces: 0, complaints: 0 };
}

export function addCounts(a: ReportCounts, b: ReportCounts): ReportCounts {
  const out = emptyCounts();
  for (const key of Object.keys(out) as (keyof ReportCounts)[]) out[key] = a[key] + b[key];
  return out;
}

export function sumCounts(rows: Iterable<ReportCounts>): ReportCounts {
  let total = emptyCounts();
  for (const row of rows) total = addCounts(total, row);
  return total;
}

/** part / whole as a fraction (0..1), or null when whole is 0. */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export interface ReportRates {
  openRate: number | null;
  clickRate: number | null;
  /** Click-to-open rate: unique clicks / unique opens. */
  ctor: number | null;
}

export function ratesOf(c: ReportCounts): ReportRates {
  return {
    openRate: rate(c.opens, c.delivered),
    clickRate: rate(c.clicks, c.delivered),
    ctor: rate(c.clicks, c.opens),
  };
}

// --- Metrics (table columns / chart choices) ---------------------------------

export const METRICS = [
  { key: "campaigns", label: "Campaigns", kind: "count" },
  { key: "sent", label: "Sent", kind: "count" },
  { key: "opens", label: "Unique opens", kind: "count" },
  { key: "openRate", label: "Open rate", kind: "rate" },
  { key: "clicks", label: "Unique clicks", kind: "count" },
  { key: "clickRate", label: "Click rate", kind: "rate" },
  { key: "ctor", label: "CTOR", kind: "rate" },
  { key: "unsubscribes", label: "Unsubscribes", kind: "count" },
  { key: "bounces", label: "Bounces", kind: "count" },
  { key: "complaints", label: "Complaints", kind: "count" },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];
export type MetricDef = (typeof METRICS)[number];

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === "string" && METRICS.some((m) => m.key === value);
}

export function metricDef(key: MetricKey): MetricDef {
  return METRICS.find((m) => m.key === key)!;
}

/** A metric's value: a count, or a rate fraction / null for N/A. */
export function metricValue(c: ReportCounts, key: MetricKey): number | null {
  if (key === "openRate" || key === "clickRate" || key === "ctor") return ratesOf(c)[key];
  return c[key];
}

/** "N/A" for a missing rate, "12.3%" for a rate, "1,234" for a count. */
export function formatMetric(value: number | null, kind: "count" | "rate"): string {
  if (value === null) return "N/A";
  if (kind === "rate") return `${(value * 100).toFixed(1)}%`;
  return new Intl.NumberFormat("en-GB").format(value);
}

// --- Comparison with the previous period -------------------------------------

export interface MetricChange {
  current: number | null;
  previous: number | null;
  /**
   * Rates: change in percentage points (e.g. 2.5 = +2.5 pp).
   * Counts: percent change. null when it can't be computed (N/A, or a zero baseline for counts).
   */
  change: number | null;
  unit: "pp" | "%";
}

export function compareMetric(current: ReportCounts, previous: ReportCounts, key: MetricKey): MetricChange {
  const def = metricDef(key);
  const cur = metricValue(current, key);
  const prev = metricValue(previous, key);
  if (def.kind === "rate") {
    return { current: cur, previous: prev, change: cur === null || prev === null ? null : (cur - prev) * 100, unit: "pp" };
  }
  // No % change from a zero baseline.
  const change = cur === null || prev === null || prev === 0 ? null : ((cur - prev) / prev) * 100;
  return { current: cur, previous: prev, change, unit: "%" };
}

/** "+2.5 pp", "-10%", "—" */
export function formatChange(c: MetricChange): string {
  if (c.change === null) return "—";
  const rounded = Math.round(c.change * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  const abs = Math.abs(rounded);
  return c.unit === "pp" ? `${sign}${abs.toFixed(1)} pp` : `${sign}${abs.toFixed(abs >= 10 ? 0 : 1)}%`;
}

// --- Calendar dates in UK time ----------------------------------------------
// A "day" is a calendar date "YYYY-MM-DD" in Europe/London. Date arithmetic
// is done on UTC-midnight timestamps of those dates, so DST never shifts it.

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === value;
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

/** Number of days from a to b, inclusive of both. */
export function daysInclusive(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a) + 1;
}

const londonDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The UK calendar date of an instant. */
export function londonDate(at: Date): string {
  return londonDateFmt.format(at);
}

const londonPartsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: REPORT_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** UK offset from UTC (ms) at an instant: 0 in winter, 3,600,000 in summer. */
function londonOffset(at: Date): number {
  const p = Object.fromEntries(londonPartsFmt.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant midnight starts on a UK calendar date. */
export function londonMidnight(date: string): Date {
  const guess = dayNumber(date) * DAY_MS;
  const first = guess - londonOffset(new Date(guess));
  return new Date(guess - londonOffset(new Date(first)));
}

// --- Report settings (URL query) ----------------------------------------------

export const RANGE_PRESETS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "month", label: "This month" },
  { value: "lastmonth", label: "Last month" },
  { value: "custom", label: "Custom dates" },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]["value"];

export const GROUP_BYS = [
  { value: "campaign", label: "Campaign" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;
export type GroupBy = (typeof GROUP_BYS)[number]["value"];

/** Custom ranges are capped so a day-by-day table stays readable. */
export const MAX_RANGE_DAYS = 731;

export interface ReportQuery {
  range: RangePreset;
  /** Custom range only (YYYY-MM-DD, UK dates, inclusive). */
  from: string | null;
  to: string | null;
  group: GroupBy;
  /** Optional list filter. */
  listId: string | null;
  /** Chart metrics (1 or 2). */
  metrics: MetricKey[];
  /** Show the previous period. */
  compare: boolean;
}

export const DEFAULT_METRICS: MetricKey[] = ["openRate", "clickRate"];

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Parse (and sanitise) report settings from the URL. Unknown values fall back to defaults. */
export function parseReportQuery(params: RawParams): ReportQuery {
  const rangeRaw = first(params.range);
  const range: RangePreset = RANGE_PRESETS.some((r) => r.value === rangeRaw) ? (rangeRaw as RangePreset) : "30d";
  const groupRaw = first(params.group);
  const group: GroupBy = GROUP_BYS.some((g) => g.value === groupRaw) ? (groupRaw as GroupBy) : "campaign";
  const from = first(params.from);
  const to = first(params.to);
  const listId = first(params.list)?.trim();
  const metrics = [first(params.m1), first(params.m2)].filter(isMetricKey);
  const unique = [...new Set(metrics)];
  return {
    range,
    from: isIsoDate(from) ? from : null,
    to: isIsoDate(to) ? to : null,
    group,
    listId: listId ? listId.slice(0, 100) : null,
    metrics: unique.length ? unique : DEFAULT_METRICS,
    compare: first(params.compare) === "1",
  };
}

/** The query string for report settings (stable order; defaults left out where harmless). */
export function reportQueryString(q: ReportQuery): string {
  const sp = new URLSearchParams();
  sp.set("range", q.range);
  if (q.range === "custom") {
    if (q.from) sp.set("from", q.from);
    if (q.to) sp.set("to", q.to);
  }
  sp.set("group", q.group);
  if (q.listId) sp.set("list", q.listId);
  if (q.metrics[0]) sp.set("m1", q.metrics[0]);
  if (q.metrics[1]) sp.set("m2", q.metrics[1]);
  if (q.compare) sp.set("compare", "1");
  return sp.toString();
}

/** An inclusive range of UK calendar dates. */
export interface DateRange {
  from: string;
  to: string;
}

/** The dates a report covers, relative to `today` (a UK date). Custom ranges are fixed up when invalid. */
export function resolveRange(q: Pick<ReportQuery, "range" | "from" | "to">, today: string): DateRange {
  switch (q.range) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "lastmonth": {
      const firstOfThis = `${today.slice(0, 7)}-01`;
      const lastOfPrev = addDays(firstOfThis, -1);
      return { from: `${lastOfPrev.slice(0, 7)}-01`, to: lastOfPrev };
    }
    case "custom": {
      let from = q.from ?? addDays(today, -29);
      let to = q.to ?? today;
      if (from > to) [from, to] = [to, from];
      if (daysInclusive(from, to) > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
      return { from, to };
    }
    default:
      return { from: addDays(today, -29), to: today };
  }
}

/** The equal-length period right before a range. */
export function previousRange(r: DateRange): DateRange {
  const length = daysInclusive(r.from, r.to);
  return { from: addDays(r.from, -length), to: addDays(r.from, -1) };
}

/** Query bounds for a range: [start, end) as instants. */
export function rangeBounds(r: DateRange): { start: Date; end: Date } {
  return { start: londonMidnight(r.from), end: londonMidnight(addDays(r.to, 1)) };
}

// --- Grouping ------------------------------------------------------------------

/** Monday of the week containing a date (UK weeks start on Monday). */
export function weekStart(date: string): string {
  const n = dayNumber(date);
  const weekday = (new Date(n * DAY_MS).getUTCDay() + 6) % 7; // Monday = 0
  return fromDayNumber(n - weekday);
}

/** Period key of a UK date: the date, its week's Monday, or "YYYY-MM". */
export function periodKey(date: string, group: Exclude<GroupBy, "campaign">): string {
  if (group === "day") return date;
  if (group === "week") return weekStart(date);
  return date.slice(0, 7);
}

/** Every period key in a range, oldest first (so empty periods show as zeros). */
export function periodKeys(r: DateRange, group: Exclude<GroupBy, "campaign">): string[] {
  const keys: string[] = [];
  let cursor = periodKey(r.from, group);
  while (cursor <= r.to) {
    keys.push(cursor);
    if (group === "day") cursor = addDays(cursor, 1);
    else if (group === "week") cursor = addDays(cursor, 7);
    else {
      const [y, m] = cursor.split("-").map(Number);
      cursor = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  return keys;
}

const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "3 Oct 2026" for a UK date. */
export function formatDay(date: string): string {
  return dayFmt.format(new Date(dayNumber(date) * DAY_MS));
}

/** Human label of a period key. */
export function periodLabel(key: string, group: Exclude<GroupBy, "campaign">): string {
  if (group === "month") return monthFmt.format(new Date(dayNumber(`${key}-01`) * DAY_MS));
  if (group === "week") return `Week of ${formatDay(key)}`;
  return formatDay(key);
}

/** One campaign's counts (campaigns = 1) and when it was sent. */
export interface CampaignCounts extends ReportCounts {
  id: string;
  name: string;
  sentAt: Date;
}

export interface ReportRow {
  key: string;
  label: string;
  /** Campaign rows only: link target. */
  campaignId?: string;
  counts: ReportCounts;
}

/**
 * Table rows: one per campaign (newest first), or one per period over the
 * whole range (oldest first, empty periods included).
 */
export function groupRows(campaigns: CampaignCounts[], group: GroupBy, range: DateRange): ReportRow[] {
  if (group === "campaign") {
    return [...campaigns]
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime() || a.id.localeCompare(b.id))
      .map((c) => ({ key: c.id, label: c.name, campaignId: c.id, counts: pickCounts(c) }));
  }
  const buckets = new Map<string, ReportCounts>(periodKeys(range, group).map((k) => [k, emptyCounts()]));
  for (const c of campaigns) {
    const key = periodKey(londonDate(c.sentAt), group);
    buckets.set(key, addCounts(buckets.get(key) ?? emptyCounts(), pickCounts(c)));
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, counts]) => ({ key, label: periodLabel(key, group), counts }));
}

function pickCounts(c: ReportCounts): ReportCounts {
  const out = emptyCounts();
  for (const key of Object.keys(out) as (keyof ReportCounts)[]) out[key] = c[key];
  return out;
}
