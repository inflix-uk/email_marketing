import type { Filter, Sort } from "mongodb";
import type { CampaignDoc, CampaignStatus } from "@/db/schema";
import { escapeRegex } from "@/lib/contacts/filters";

// The campaigns list: tabs (Sent / Drafts / Outbox / Archived), search, sort
// and folder filter, all kept in the URL (?tab= ?q= ?sort= ?folder= ?page=).
// Builds MongoDB filters only - no database access - so it is unit-testable.

export const CAMPAIGN_TABS = ["sent", "drafts", "outbox", "archived"] as const;
export type CampaignTab = (typeof CAMPAIGN_TABS)[number];

export const CAMPAIGN_SORTS = ["date", "newest", "name"] as const;
export type CampaignSort = (typeof CAMPAIGN_SORTS)[number];

export const TAB_STATUSES: Record<Exclude<CampaignTab, "archived">, CampaignStatus[]> = {
  sent: ["sent", "cancelled"],
  drafts: ["draft"],
  outbox: ["scheduled", "sending", "paused"],
};

/** Campaigns that can be archived (not while scheduled or sending). */
export const ARCHIVABLE_STATUSES: CampaignStatus[] = ["draft", "sent", "cancelled"];

export const MAX_FOLDER_LENGTH = 60;
export const MAX_SEARCH_LENGTH = 200;

/** Trim and collapse a folder name; "" = no folder. */
export function normalizeFolder(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_FOLDER_LENGTH);
}

export interface WorkspaceParams {
  tab: CampaignTab | null;
  q: string;
  sort: CampaignSort;
  folder: string;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseWorkspaceParams(params: Record<string, string | string[] | undefined>): WorkspaceParams {
  const tab = CAMPAIGN_TABS.find((t) => t === first(params.tab)) ?? null;
  const sort = CAMPAIGN_SORTS.find((s) => s === first(params.sort)) ?? "date";
  return {
    tab,
    q: first(params.q).trim().slice(0, MAX_SEARCH_LENGTH),
    sort,
    folder: normalizeFolder(first(params.folder)),
  };
}

/** Archived campaigns, or the not-archived campaigns of one tab. */
export function tabFilter(tab: CampaignTab): Filter<CampaignDoc> {
  if (tab === "archived") return { archivedAt: { $ne: null }, parentId: null };
  // Missing archivedAt (older documents) counts as not archived.
  return { status: { $in: TAB_STATUSES[tab] }, archivedAt: null, parentId: null };
}

/** Search + folder, shared by every tab (so the tab counts match what you'd see). */
export function searchFilter(q: string, folder: string): Filter<CampaignDoc> {
  const clauses: Filter<CampaignDoc>[] = [];
  if (q) {
    const contains = { $regex: escapeRegex(q), $options: "i" };
    clauses.push({ $or: [{ name: contains }, { subject: contains }] });
  }
  if (folder) clauses.push({ folder });
  if (clauses.length === 0) return {};
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

export function workspaceFilter(tab: CampaignTab, q: string, folder: string): Filter<CampaignDoc> {
  const search = searchFilter(q, folder);
  return Object.keys(search).length ? { $and: [tabFilter(tab), search] } : tabFilter(tab);
}

/** `_id` last keeps pagination stable. A descending date sort puts missing dates last. */
export function workspaceSort(tab: CampaignTab, sort: CampaignSort): Sort {
  if (sort === "name") return { name: 1, _id: 1 };
  if (sort === "newest") return { createdAt: -1, _id: 1 };
  switch (tab) {
    case "sent":
      return { completedAt: -1, startedAt: -1, _id: 1 };
    case "outbox":
      return { scheduledAt: 1, startedAt: -1, _id: 1 };
    default:
      return { updatedAt: -1, _id: 1 };
  }
}

/** The "date" sort is named after what it sorts by on each tab. */
export function dateSortLabel(tab: CampaignTab): string {
  return tab === "sent" ? "Sent date" : tab === "outbox" ? "Send time" : "Last saved";
}

/** Default tab: Sent when there is anything sent, else whichever tab has campaigns. */
export function defaultTab(counts: Record<CampaignTab, number>): CampaignTab {
  return (["sent", "drafts", "outbox"] as const).find((t) => counts[t] > 0) ?? "sent";
}

/** /campaigns?tab=..&q=.. with defaults left out. */
export function workspaceHref(p: Partial<WorkspaceParams> & { page?: number }): string {
  const sp = new URLSearchParams();
  if (p.tab) sp.set("tab", p.tab);
  if (p.q) sp.set("q", p.q);
  if (p.sort && p.sort !== "date") sp.set("sort", p.sort);
  if (p.folder) sp.set("folder", p.folder);
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  const qs = sp.toString();
  return qs ? `/campaigns?${qs}` : "/campaigns";
}
