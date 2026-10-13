import { formatDateTime } from "@/lib/utils";

const HOUR_MS = 60 * 60 * 1000;
const MAX_HOURS = 72;

export interface TimelinePoint {
  /** Hours since sending started (0 = the first hour). */
  hour: number;
  /** Clock time of the hour, already formatted. */
  label: string;
  opens: number;
  clicks: number;
}

/**
 * Turn the hourly buckets of getCampaignTimeline (which may skip quiet hours)
 * into one point per hour, from the hour sending started up to now - at most
 * the first 72 hours. Empty when there is no activity to plot.
 */
export function buildTimeline(
  buckets: { t: Date; opens: number; clicks: number }[],
  startedAt: Date | null,
  now = new Date(),
): TimelinePoint[] {
  const active = buckets
    .filter((b) => b.opens > 0 || b.clicks > 0)
    .sort((a, b) => a.t.getTime() - b.t.getTime());
  if (active.length === 0) return [];

  // Hour 0 is the bucket sending started in; later buckets are whole hours after it.
  const first = buckets.reduce((min, b) => Math.min(min, b.t.getTime()), Infinity);
  const lead = startedAt && startedAt.getTime() < first ? Math.floor((first - startedAt.getTime()) / HOUR_MS) : 0;
  const origin = first - lead * HOUR_MS;
  const indexOf = (t: Date) => Math.round((t.getTime() - origin) / HOUR_MS);

  const lastActive = indexOf(active[active.length - 1].t);
  const elapsed = Math.ceil((now.getTime() - origin) / HOUR_MS);
  const length = Math.min(MAX_HOURS, Math.max(lastActive + 1, elapsed, 1));

  const points: TimelinePoint[] = Array.from({ length }, (_, hour) => ({
    hour,
    label: formatDateTime(new Date(origin + hour * HOUR_MS)),
    opens: 0,
    clicks: 0,
  }));
  for (const bucket of active) {
    const point = points[indexOf(bucket.t)];
    if (!point) continue; // beyond the first 72 hours
    point.opens += bucket.opens;
    point.clicks += bucket.clicks;
  }
  return points;
}
