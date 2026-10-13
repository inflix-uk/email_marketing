// Daily send limit (Settings > Deliverability), used to warm up a new sending
// domain: at most `dailySendLimit` emails per calendar day (UTC), counted over
// every kind of send (campaigns + automations). 0 = no limit.

import { collections } from "@/db";
import { getSettings } from "@/lib/settings";

/** 00:00 UTC of the day `now` falls on. */
export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** "2026-01-31" (UTC) - handy for "log once per day". */
export function utcDayKey(now: Date = new Date()): string {
  return startOfUtcDay(now).toISOString().slice(0, 10);
}

/** Emails still allowed today: Infinity without a limit, never negative. */
export function quotaLeft(dailySendLimit: unknown, sentToday: number): number {
  const limit = Math.floor(Number(dailySendLimit));
  if (!Number.isFinite(limit) || limit <= 0) return Infinity;
  return Math.max(0, limit - Math.max(0, sentToday));
}

const globalForQuota = globalThis as unknown as { sentAtIndex?: Promise<unknown> };

/** Emails sent since 00:00 UTC today, all kinds. */
export async function countSentToday(now: Date = new Date()): Promise<number> {
  const { sends } = await collections();
  // Counting by date needs its own index; created once per process (a no-op
  // when it exists) so the count stays cheap however large `sends` gets.
  globalForQuota.sentAtIndex ??= sends.createIndex({ sentAt: 1 }).catch(() => {
    globalForQuota.sentAtIndex = undefined;
  });
  await globalForQuota.sentAtIndex;
  return sends.countDocuments({ sentAt: { $gte: startOfUtcDay(now) } });
}

/**
 * How many more emails may go out today. Infinity when
 * settings.dailySendLimit is 0; otherwise the limit minus today's sends
 * (sentAt >= 00:00 UTC, campaigns and automations alike), never negative.
 */
export async function remainingDailyQuota(): Promise<number> {
  const { dailySendLimit } = await getSettings();
  if (quotaLeft(dailySendLimit, 0) === Infinity) return Infinity;
  return quotaLeft(dailySendLimit, await countSentToday());
}
