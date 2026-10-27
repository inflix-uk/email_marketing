// Time buckets for activity charts, in the UK timezone. Pure.
// The database groups with $dateToString (format + timezone below); this
// module produces the same keys in JS to zero-fill and label the buckets.

export const REPORT_TIME_ZONE = "Europe/London";

export type BucketUnit = "hour" | "day";

/** $dateToString formats matching bucketKey(). */
export const MONGO_BUCKET_FORMAT: Record<BucketUnit, string> = { hour: "%Y-%m-%d %H", day: "%Y-%m-%d" };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export function bucketKey(date: Date, unit: BucketUnit): string {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  return unit === "day" ? day : `${day} ${p.hour}`;
}

const shortDay = new Intl.DateTimeFormat("en-GB", { timeZone: REPORT_TIME_ZONE, day: "numeric", month: "short" });
/** "27 Oct 09:00" - the start of the UK hour containing the date. */
const hourLabel = { format: (d: Date) => `${shortDay.format(d)} ${bucketKey(d, "hour").slice(11)}:00` };
const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: REPORT_TIME_ZONE, weekday: "short", day: "numeric", month: "short" });

const ukDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: REPORT_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "27 Oct 2026, 09:05:12" in UK time ("—" for null). */
export function formatUkDateTime(d: Date | null | undefined): string {
  return d ? ukDateTime.format(d) : "—";
}

/** Hourly up to 72 hours, then daily. */
export function chooseUnit(start: Date, end: Date): BucketUnit {
  return end.getTime() - start.getTime() <= 72 * HOUR_MS ? "hour" : "day";
}

export interface Bucket {
  key: string;
  label: string;
  start: Date;
}

/** Every bucket from `start` to `end` (inclusive of the bucket containing `end`), in order, without duplicates. */
export function bucketsBetween(start: Date, end: Date, unit: BucketUnit, max = 120): Bucket[] {
  const step = unit === "hour" ? HOUR_MS : DAY_MS / 4; // quarter-day steps never skip a DST-shifted day
  const result: Bucket[] = [];
  const seen = new Set<string>();
  const fmt = unit === "hour" ? hourLabel : dayLabel;
  const add = (at: Date) => {
    const key = bucketKey(at, unit);
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ key, label: fmt.format(at), start: at });
  };
  for (let t = start.getTime(); t < end.getTime() && result.length < max; t += step) add(new Date(t));
  if (result.length < max) add(end);
  return result;
}
