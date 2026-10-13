import { collections } from "@/db";
import type { CampaignStatus } from "@/db/schema";
import { getCampaignsStats, type CampaignStats } from "@/lib/sending";
import { getSettings, isDevMailer } from "@/lib/settings";

const DAY_MS = 24 * 60 * 60 * 1000;
export const STATS_WINDOW_DAYS = 30;

export interface RecentCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  createdAt: Date;
  updatedAt: Date;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  totalRecipients: number;
  stats: CampaignStats | undefined;
}

export interface DashboardData {
  contacts: {
    total: number;
    subscribed: number;
    /** Signed up through a double opt-in form, not confirmed yet. */
    pending: number;
    unsubscribed: number;
    bounced: number;
    complained: number;
  };
  listCount: number;
  templateCount: number;
  campaignCount: number;
  formCount: number;
  /** Automations that are switched on. */
  activeAutomationCount: number;
  /** Campaigns that have started sending at least once (for the checklist). */
  everSentCount: number;
  sendingNow: number;
  /** Campaigns that finished sending in the stats window, and their combined engagement. */
  window: { campaigns: number; sent: number; opened: number; clicked: number; bounced: number; complained: number };
  recent: RecentCampaign[];
  /** An email provider is connected and a sender address is set. */
  sendingConfigured: boolean;
}

export async function getDashboardData(): Promise<DashboardData> {
  const db = await collections();
  const since = new Date(Date.now() - STATS_WINDOW_DAYS * DAY_MS);

  const [
    statusRows,
    listCount,
    templateCount,
    campaignCount,
    formCount,
    activeAutomationCount,
    everSentCount,
    sendingNow,
    windowRows,
    recentDocs,
    settings,
  ] = await Promise.all([
    db.contacts
      .aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }])
      .toArray(),
    db.lists.countDocuments(),
    db.templates.countDocuments(),
    db.campaigns.countDocuments(),
    db.forms.countDocuments(),
    db.automations.countDocuments({ status: "active" }),
    db.campaigns.countDocuments({ $or: [{ startedAt: { $ne: null } }, { status: { $in: ["sending", "sent"] } }] }),
    db.campaigns.countDocuments({ status: "sending" }),
    // When a campaign "was sent": completion time, falling back for older documents.
    db.campaigns
      .find(
        {
          status: "sent",
          $expr: { $gte: [{ $ifNull: ["$completedAt", { $ifNull: ["$startedAt", "$updatedAt"] }] }, since] },
        },
        { projection: { _id: 1 } },
      )
      .toArray(),
    db.campaigns
      .find(
        {},
        {
          sort: { updatedAt: -1 },
          limit: 5,
          projection: {
            name: 1,
            status: 1,
            createdAt: 1,
            updatedAt: 1,
            scheduledAt: 1,
            startedAt: 1,
            completedAt: 1,
            totalRecipients: 1,
          },
        },
      )
      .toArray(),
    getSettings(),
  ]);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r._id, r.n])) as Record<string, number>;
  const contacts = {
    total: statusRows.reduce((sum, r) => sum + r.n, 0),
    subscribed: byStatus.subscribed ?? 0,
    pending: byStatus.pending ?? 0,
    unsubscribed: byStatus.unsubscribed ?? 0,
    bounced: byStatus.bounced ?? 0,
    complained: byStatus.complained ?? 0,
  };

  const windowIds = windowRows.map((r) => r._id);
  const ids = [...new Set([...windowIds, ...recentDocs.map((r) => r._id)])];
  const stats = ids.length ? await getCampaignsStats(ids) : new Map<string, CampaignStats>();

  // Weighted by sent count: total opens / total sent across the window.
  const window = { campaigns: windowIds.length, sent: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 };
  for (const id of windowIds) {
    const s = stats.get(id);
    if (!s) continue;
    window.sent += s.sent;
    window.opened += s.opened;
    window.clicked += s.clicked;
    window.bounced += s.bounced;
    window.complained += s.complained;
  }

  return {
    contacts,
    listCount,
    templateCount,
    campaignCount,
    formCount,
    activeAutomationCount,
    everSentCount,
    sendingNow,
    window,
    recent: recentDocs.map((c) => ({
      id: c._id,
      name: c.name,
      status: c.status,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      scheduledAt: c.scheduledAt ?? null,
      startedAt: c.startedAt ?? null,
      completedAt: c.completedAt ?? null,
      totalRecipients: c.totalRecipients ?? 0,
      stats: stats.get(c._id),
    })),
    sendingConfigured: !isDevMailer(settings) && Boolean(settings.fromEmail),
  };
}
