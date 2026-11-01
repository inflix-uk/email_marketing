// Read-side helpers for the campaign-type report sections.

import { collections } from "@/db";
import type { CampaignStatus } from "@/db/schema";
import { getCampaignsStats, type CampaignStats } from "@/lib/sending/stats";

export interface UniquePeople {
  /** People sent at least one of the emails. */
  sent: number;
  opened: number;
  clicked: number;
}

/**
 * Unique people over several campaigns (the first email + its resend): a
 * person who opened both counts once - a union, not a sum.
 */
export async function getUniquePeople(campaignIds: string[]): Promise<UniquePeople> {
  const { sends } = await collections();
  const set = (field: string) => ({ $ne: [{ $ifNull: [field, null] }, null] });
  const row = await sends
    .aggregate<UniquePeople>(
      [
        { $match: { campaignId: { $in: campaignIds } } },
        {
          $group: {
            _id: "$contactId",
            sent: { $max: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] } },
            opened: { $max: { $cond: [set("$openedAt"), 1, 0] } },
            clicked: { $max: { $cond: [set("$clickedAt"), 1, 0] } },
          },
        },
        { $group: { _id: null, sent: { $sum: "$sent" }, opened: { $sum: "$opened" }, clicked: { $sum: "$clicked" } } },
        { $project: { _id: 0, sent: 1, opened: 1, clicked: 1 } },
      ],
      { allowDiskUse: true },
    )
    .next();
  return row ?? { sent: 0, opened: 0, clicked: 0 };
}

export interface ResendReport {
  initial: CampaignStats;
  resend: CampaignStats | null;
  combined: UniquePeople;
}

export async function getResendReport(campaignId: string, childId: string | null): Promise<ResendReport> {
  const ids = childId ? [campaignId, childId] : [campaignId];
  const [stats, combined] = await Promise.all([getCampaignsStats(ids), getUniquePeople(ids)]);
  return {
    initial: stats.get(campaignId)!,
    resend: childId ? (stats.get(childId) ?? null) : null,
    combined,
  };
}

export interface RunRow {
  id: string;
  name: string;
  subject: string;
  status: CampaignStatus;
  createdAt: Date;
  stats: CampaignStats;
}

/** Child campaigns of a series (newest first). */
export async function getChildRuns(parentId: string, limit = 50): Promise<RunRow[]> {
  const { campaigns } = await collections();
  const docs = await campaigns
    .find({ parentId }, { projection: { name: 1, subject: 1, status: 1, createdAt: 1 } })
    .sort({ createdAt: -1, _id: 1 })
    .limit(limit)
    .toArray();
  const stats = await getCampaignsStats(docs.map((d) => d._id));
  return docs.map((d) => ({
    id: d._id,
    name: d.name,
    subject: d.subject,
    status: d.status,
    createdAt: d.createdAt,
    stats: stats.get(d._id)!,
  }));
}

/** Names of templates (for labelling A/B versions). */
export async function getTemplateNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { templates } = await collections();
  const rows = await templates.find({ _id: { $in: unique } }, { projection: { name: 1 } }).toArray();
  return new Map(rows.map((t) => [t._id, t.name]));
}
