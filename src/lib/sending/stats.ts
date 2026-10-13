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
    openCount: 0,
    clickCount: 0,
  };
}

const countIf = (cond: Document) => ({ $sum: { $cond: [cond, 1, 0] } });
const statusIs = (status: string) => countIf({ $eq: ["$status", status] });
/** Field is set (not null / missing). */
const isSet = (field: string) => ({ $ne: [{ $ifNull: [field, null] }, null] });

/** One $group stage computing every CampaignStats field per campaign. */
const STATS_GROUP: Document = {
  $group: {
    _id: "$campaignId",
    total: { $sum: 1 },
    queued: statusIs("queued"),
    sending: statusIs("sending"),
    sent: statusIs("sent"),
    failed: statusIs("failed"),
    skipped: statusIs("skipped"),
    opened: countIf(isSet("$openedAt")),
    clicked: countIf(isSet("$clickedAt")),
    unsubscribed: countIf(isSet("$unsubscribedAt")),
    openCount: { $sum: { $ifNull: ["$openCount", 0] } },
    clickCount: { $sum: { $ifNull: ["$clickCount", 0] } },
  },
};

type StatsRow = CampaignStats & { _id: string };

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
    .aggregate<StatsRow>([{ $match: { campaignId: { $in: ids } } }, STATS_GROUP], { allowDiskUse: true })
    .toArray();
  for (const row of rows) result.set(row._id, toStats(row));
  return result;
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
