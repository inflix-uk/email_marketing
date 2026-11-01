import type { Document, Filter } from "mongodb";
import { collections } from "@/db";
import type { CampaignDoc } from "@/db/schema";
import { emptyCounts, rangeBounds, type CampaignCounts, type DateRange } from "./rollup";

// Database side of the cross-campaign report (/reports): one aggregation over
// `sends` gives per-campaign counts; rollup.ts groups and totals them.
//
// Only real campaigns are counted: automation emails use a campaignId that is
// not in `campaigns`, and test sends are never stored as sends.

/** Campaigns that actually started sending (drafts and scheduled ones have no startedAt). */
const SENT_STATUSES: CampaignDoc["status"][] = ["sending", "paused", "sent", "cancelled"];

const countIf = (cond: Document) => ({ $sum: { $cond: [cond, 1, 0] } });
const isSet = (field: string) => ({ $ne: [{ $ifNull: [field, null] }, null] });

interface Row {
  _id: string;
  sent: number;
  opens: number;
  clicks: number;
  unsubscribes: number;
  bounces: number;
  complaints: number;
}

/** Per-campaign counts for the campaigns that started sending within a range (optionally on one list). */
export async function getCampaignCounts(range: DateRange, listId: string | null): Promise<CampaignCounts[]> {
  const { campaigns, sends } = await collections();
  const { start, end } = rangeBounds(range);
  const filter: Filter<CampaignDoc> = { status: { $in: SENT_STATUSES }, startedAt: { $gte: start, $lt: end } };
  if (listId) filter.listIds = listId;

  const docs = await campaigns
    .find(filter, { projection: { name: 1, startedAt: 1, format: 1 } })
    .sort({ startedAt: -1 })
    .toArray();
  if (docs.length === 0) return [];

  const rows = await sends
    .aggregate<Row>(
      [
        { $match: { campaignId: { $in: docs.map((d) => d._id) }, kind: { $ne: "automation" } } },
        {
          $group: {
            _id: "$campaignId",
            sent: countIf({ $eq: ["$status", "sent"] }),
            opens: countIf(isSet("$openedAt")),
            clicks: countIf(isSet("$clickedAt")),
            unsubscribes: countIf(isSet("$unsubscribedAt")),
            // Hard or soft, each email once - the same as the campaign report's Bounces card.
            bounces: countIf({ $or: [isSet("$bouncedAt"), isSet("$softBouncedAt")] }),
            complaints: countIf(isSet("$complainedAt")),
          },
        },
      ],
      { allowDiskUse: true },
    )
    .toArray();
  const byId = new Map(rows.map((r) => [r._id, r]));

  return docs.map((d) => {
    const r = byId.get(d._id);
    const counts = emptyCounts();
    if (r) {
      counts.sent = r.sent;
      // Plain-text-only emails have no open pixel or tracked links: leave them out of the rate denominators.
      counts.tracked = d.format === "text" ? 0 : r.sent;
      counts.opens = r.opens;
      counts.clicks = r.clicks;
      counts.unsubscribes = r.unsubscribes;
      counts.bounces = r.bounces;
      counts.complaints = r.complaints;
    }
    return { ...counts, campaigns: 1, id: d._id, name: d.name, sentAt: d.startedAt as Date };
  });
}
