import type { Document } from "mongodb";
import { collections } from "@/db";

export interface CampaignStats {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Unique opens (sends with openedAt). */
  opened: number;
  /** Unique clicks (sends with clickedAt). */
  clicked: number;
  unsubscribed: number;
  /** Hard bounces (sends with bouncedAt): reported by the provider or rejected by the mailbox at send time. */
  bounced: number;
  /** Spam complaints (sends with complainedAt). */
  complained: number;
  /** Total opens. */
  openCount: number;
  /** Total clicks. */
  clickCount: number;
}

export function emptyStats(): CampaignStats {
  return {
    total: 0,
    queued: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    opened: 0,
    clicked: 0,
    unsubscribed: 0,
    bounced: 0,
    complained: 0,
    openCount: 0,
    clickCount: 0,
  };
}

const countIf = (cond: Document) => ({ $sum: { $cond: [cond, 1, 0] } });
const statusIs = (status: string) => countIf({ $eq: ["$status", status] });
/** Field is set (not null / missing). */
const isSet = (field: string) => ({ $ne: [{ $ifNull: [field, null] }, null] });

/** A $group stage computing every CampaignStats field per `groupBy` value. */
const statsGroup = (groupBy: string): Document => ({
  $group: {
    _id: groupBy,
    total: { $sum: 1 },
    queued: statusIs("queued"),
    sending: statusIs("sending"),
    sent: statusIs("sent"),
    failed: statusIs("failed"),
    skipped: statusIs("skipped"),
    opened: countIf(isSet("$openedAt")),
    clicked: countIf(isSet("$clickedAt")),
    unsubscribed: countIf(isSet("$unsubscribedAt")),
    bounced: countIf(isSet("$bouncedAt")),
    complained: countIf(isSet("$complainedAt")),
    openCount: { $sum: { $ifNull: ["$openCount", 0] } },
    clickCount: { $sum: { $ifNull: ["$clickCount", 0] } },
  },
});

type StatsRow = CampaignStats & { _id: string | null };

function toStats(row: StatsRow): CampaignStats {
  const stats = emptyStats();
  for (const key of Object.keys(stats) as (keyof CampaignStats)[]) stats[key] = Number(row[key] ?? 0);
  return stats;
}

export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  return (await getCampaignsStats([campaignId])).get(campaignId) ?? emptyStats();
}

/** Stats for many campaigns in one aggregation. Campaigns with no sends get zeros. */
export async function getCampaignsStats(campaignIds: string[]): Promise<Map<string, CampaignStats>> {
  const ids = [...new Set(campaignIds.filter(Boolean))];
  const result = new Map<string, CampaignStats>(ids.map((id) => [id, emptyStats()]));
  if (ids.length === 0) return result;
  const { sends } = await collections();
  const rows = await sends
    .aggregate<StatsRow>([{ $match: { campaignId: { $in: ids } } }, statsGroup("$campaignId")], { allowDiskUse: true })
    .toArray();
  for (const row of rows) if (row._id !== null) result.set(row._id, toStats(row));
  return result;
}

/**
 * Stats per A/B variant (test-group sends only; the sends that got the
 * winning subject afterwards have no variant). null when the campaign has no
 * A/B test.
 */
export async function getVariantStats(campaignId: string): Promise<{ A: CampaignStats; B: CampaignStats } | null> {
  const { campaigns, sends } = await collections();
  const campaign = await campaigns.findOne({ _id: campaignId }, { projection: { abTest: 1 } });
  if (!campaign?.abTest) return null;
  const rows = await sends
    .aggregate<StatsRow>([{ $match: { campaignId, variant: { $in: ["A", "B"] } } }, statsGroup("$variant")], {
      allowDiskUse: true,
    })
    .toArray();
  const result = { A: emptyStats(), B: emptyStats() };
  for (const row of rows) if (row._id === "A" || row._id === "B") result[row._id] = toStats(row);
  return result;
}

const HOUR_MS = 3_600_000;
/** The timeline covers this many hours after the first send. */
export const TIMELINE_HOURS = 72;

/**
 * Opens and clicks per hour: hourly buckets (UTC, `t` = start of the hour) of
 * first opens (sends.openedAt) and clicks (clicks.createdAt), from the hour of
 * the first send up to now, at most 72 hours, zero-filled. Empty before the
 * first email is sent.
 */
export async function getCampaignTimeline(campaignId: string): Promise<{ t: Date; opens: number; clicks: number }[]> {
  const { sends, clicks } = await collections();
  const first = await sends
    .aggregate<{ at: Date | null }>([
      { $match: { campaignId, status: "sent" } },
      { $group: { _id: null, at: { $min: "$sentAt" } } },
    ])
    .next();
  if (!first?.at) return [];

  const start = new Date(Math.floor(first.at.getTime() / HOUR_MS) * HOUR_MS);
  const hours = Math.min(TIMELINE_HOURS, Math.max(1, Math.ceil((Date.now() - start.getTime()) / HOUR_MS)));
  const end = new Date(start.getTime() + hours * HOUR_MS);

  // Bucket index = whole hours since `start` (plain arithmetic: works on every MongoDB version).
  const perHour = (field: string): Document[] => [
    { $match: { campaignId, [field]: { $gte: start, $lt: end } } },
    { $group: { _id: { $floor: { $divide: [{ $subtract: [`$${field}`, start] }, HOUR_MS] } }, n: { $sum: 1 } } },
  ];
  const [opens, clicked] = await Promise.all([
    sends.aggregate<{ _id: number; n: number }>(perHour("openedAt")).toArray(),
    clicks.aggregate<{ _id: number; n: number }>(perHour("createdAt")).toArray(),
  ]);

  const timeline = Array.from({ length: hours }, (_, i) => ({
    t: new Date(start.getTime() + i * HOUR_MS),
    opens: 0,
    clicks: 0,
  }));
  for (const row of opens) if (timeline[row._id]) timeline[row._id].opens = row.n;
  for (const row of clicked) if (timeline[row._id]) timeline[row._id].clicks = row.n;
  return timeline;
}

/** Most-clicked links: total clicks and unique clickers (distinct sends) per URL. */
export async function getTopLinks(
  campaignId: string,
  limit = 10,
): Promise<{ url: string; clicks: number; uniqueClicks: number }[]> {
  const { clicks } = await collections();
  return clicks
    .aggregate<{ url: string; clicks: number; uniqueClicks: number }>(
      [
        { $match: { campaignId } },
        // Per (url, send) first, so unique clicks never need a big in-memory set.
        { $group: { _id: { url: "$url", sendId: "$sendId" }, n: { $sum: 1 } } },
        { $group: { _id: "$_id.url", clicks: { $sum: "$n" }, uniqueClicks: { $sum: 1 } } },
        { $sort: { clicks: -1, _id: 1 } },
        { $limit: Math.max(1, Math.floor(limit)) },
        { $project: { _id: 0, url: "$_id", clicks: 1, uniqueClicks: 1 } },
      ],
      { allowDiskUse: true },
    )
    .toArray();
}
