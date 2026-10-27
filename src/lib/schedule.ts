// Scheduling helpers: a campaign is scheduled as a wall-clock time in an IANA
// timezone ("2026-10-27T20:00" in "Europe/London"); the UTC instant is derived
// from it. Pure (Intl only), so it works in the browser, the server and tests,
// and handles daylight-saving changes.

export const DEFAULT_TIME_ZONE = "Europe/London";

/** "YYYY-MM-DDTHH:mm" - the value of a datetime-local input. */
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

function wallClock(date: Date, tz: string) {
  const parts: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Offset of `tz` from UTC at that instant, in minutes (Europe/London in summer = 60). */
export function timeZoneOffsetMinutes(date: Date, tz: string): number {
  const w = wallClock(date, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** "UTC+01:00" */
export function formatUtcOffset(date: Date, tz: string): string {
  const offset = timeZoneOffsetMinutes(date, tz);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The instant as "YYYY-MM-DDTHH:mm" on the wall clock of `tz`. */
export function utcToZonedLocal(date: Date, tz: string): string {
  const w = wallClock(date, tz);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/**
 * The UTC instant of a wall-clock time in `tz`. Returns null for a malformed
 * value, an unknown timezone, or a time that doesn't exist (skipped when the
 * clocks go forward). A repeated time (clocks go back) resolves to the first one.
 */
export function zonedLocalToUtc(local: string, tz: string): Date | null {
  const m = LOCAL_RE.exec(local.trim());
  if (!m || !isValidTimeZone(tz)) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(guess)) return null;

  // Try the offsets in force just before and after the guess; keep the earliest that matches.
  const candidates = new Set<number>();
  for (const probe of [guess - 12 * 3_600_000, guess, guess + 12 * 3_600_000]) {
    candidates.add(guess - timeZoneOffsetMinutes(new Date(probe), tz) * 60_000);
  }
  const wanted = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  const matches = [...candidates].filter((t) => utcToZonedLocal(new Date(t), tz) === wanted).sort((a, b) => a - b);
  return matches.length ? new Date(matches[0]) : null;
}

export type ScheduleCheck = { ok: true; at: Date; local: string; timeZone: string } | { ok: false; error: string };

export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** Validate a requested send time. */
export function checkSchedule(local: string, tz: string, now: Date = new Date()): ScheduleCheck {
  const timeZone = tz.trim() || DEFAULT_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) return { ok: false, error: "Pick a valid timezone." };
  if (!local.trim()) return { ok: false, error: "Pick a date and time." };
  const at = zonedLocalToUtc(local, timeZone);
  if (!at) {
    return LOCAL_RE.test(local.trim())
      ? { ok: false, error: "That time doesn't exist in this timezone (the clocks go forward). Pick another time." }
      : { ok: false, error: "Pick a date and time." };
  }
  if (at.getTime() <= now.getTime()) return { ok: false, error: "Pick a time in the future." };
  if (at.getTime() - now.getTime() > MAX_SCHEDULE_AHEAD_MS) return { ok: false, error: "You can schedule up to a year ahead." };
  return { ok: true, at, local: local.trim(), timeZone };
}

const displayFormatters = new Map<string, Intl.DateTimeFormat>();

/** "Tue, 27 Oct 2026, 20:00 Europe/London (UTC+00:00)" */
export function formatInTimeZone(date: Date, tz: string): string {
  const timeZone = isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
  let f = displayFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    displayFormatters.set(timeZone, f);
  }
  return `${f.format(date)} ${timeZone} (${formatUtcOffset(date, timeZone)})`;
}

/** Every IANA timezone the runtime knows (falls back to a short list). */
export function listTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf?.("timeZone") ?? [];
  const all = new Set([DEFAULT_TIME_ZONE, "UTC", ...zones]);
  return [...all].sort((a, b) => a.localeCompare(b));
}
