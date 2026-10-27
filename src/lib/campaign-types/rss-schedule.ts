// When an RSS series runs next: daily or weekly at a wall-clock time in a
// timezone (Europe/London by default, so 08:00 stays 08:00 across BST/GMT).
// Pure, no dependencies (Intl only), unit-tested.

export const RSS_TIME_ZONE = "Europe/London";

export interface RssSchedule {
  frequency: "daily" | "weekly";
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** "HH:mm" */
  time: string;
  timeZone?: string;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function parseTime(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Wall-clock parts of an instant in a timezone. */
export function zonedParts(date: Date, timeZone: string): ZonedParts & { second: number } {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: SHORT_DAYS.indexOf(parts.weekday),
  };
}

/** Offset (ms) of the timezone from UTC at this instant. */
function offsetAt(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` shows this date and time.
 * A time skipped by a DST jump resolves to the hour after it.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - offsetAt(new Date(guess), timeZone);
  const second = guess - offsetAt(new Date(result), timeZone);
  if (second !== result) result = second;
  return new Date(result);
}

/** The first scheduled time strictly after `after`. */
export function nextRunAfter(after: Date, schedule: RssSchedule): Date {
  const timeZone = schedule.timeZone || RSS_TIME_ZONE;
  const time = parseTime(schedule.time) ?? { hour: 8, minute: 0 };
  const local = zonedParts(after, timeZone);
  for (let i = 0; i <= 8; i++) {
    // Calendar arithmetic on the local date (UTC date maths never hits DST).
    const d = new Date(Date.UTC(local.year, local.month - 1, local.day + i));
    const weekday = d.getUTCDay();
    if (schedule.frequency === "weekly" && weekday !== ((schedule.weekday % 7) + 7) % 7) continue;
    const at = zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), time.hour, time.minute, timeZone);
    if (at.getTime() > after.getTime()) return at;
  }
  // Unreachable for valid input; fall back to a day later.
  return new Date(after.getTime() + 24 * 3_600_000);
}

/** "27 Oct 2026, 08:00 UK time" */
export function formatInZone(date: Date, timeZone: string = RSS_TIME_ZONE): string {
  const text = new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date);
  return `${text} ${timeZone === RSS_TIME_ZONE ? "UK time" : timeZone}`;
}

/** "Every day at 08:00" / "Every Monday at 08:00" (UK time). */
export function describeSchedule(schedule: RssSchedule): string {
  const when = schedule.frequency === "weekly" ? `Every ${WEEKDAYS[schedule.weekday] ?? "Monday"}` : "Every day";
  const zone = (schedule.timeZone || RSS_TIME_ZONE) === RSS_TIME_ZONE ? "UK time" : schedule.timeZone;
  return `${when} at ${schedule.time} (${zone})`;
}
