import { parseReportFilter, type ReportFilter } from "@/lib/reports/campaign";

// The report's URL state: /campaigns/<id>?tab=&filter=&q=&page=&send=&bots=hide

export const REPORT_TABS = ["overview", "recipients", "links", "click-map", "devices"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

export const REPORT_TAB_LABELS: Record<ReportTab, string> = {
  overview: "Overview",
  recipients: "Recipients",
  links: "Links",
  "click-map": "Click map",
  devices: "Devices & location",
};

export interface ReportState {
  campaignId: string;
  tab: ReportTab;
  filter: ReportFilter;
  search: string;
  page: number;
  /** Recipient whose timeline is open. */
  sendId: string | null;
  hideBots: boolean;
}

type Raw = string | string[] | undefined;
const first = (v: Raw) => (Array.isArray(v) ? v[0] : v);

export function parseReportState(campaignId: string, q: Record<string, Raw>): ReportState {
  const tab = REPORT_TABS.find((t) => t === first(q.tab)) ?? "overview";
  const page = Number(first(q.page));
  const send = first(q.send);
  return {
    campaignId,
    tab,
    filter: parseReportFilter(first(q.filter)),
    search: (first(q.q) ?? "").slice(0, 100),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    sendId: send && /^[A-Za-z0-9-]{8,64}$/.test(send) ? send : null,
    hideBots: first(q.bots) === "hide",
  };
}

/** A report URL: the current state with some parts changed. Defaults are left out of the URL. */
export function reportHref(state: ReportState, change: Partial<Omit<ReportState, "campaignId">> = {}): string {
  const s = { ...state, ...change };
  const qs = new URLSearchParams();
  if (s.tab !== "overview") qs.set("tab", s.tab);
  if (s.tab === "recipients") {
    if (s.filter !== "all") qs.set("filter", s.filter);
    if (s.search) qs.set("q", s.search);
    if (s.page > 1) qs.set("page", String(s.page));
    if (s.sendId) qs.set("send", s.sendId);
  }
  if (s.hideBots) qs.set("bots", "hide");
  const str = qs.toString();
  return `/campaigns/${s.campaignId}${str ? `?${str}` : ""}`;
}

/** Plain-text campaigns (campaign.format, missing = "html") have no open pixel and no click map. */
export function isTextOnly(campaign: object): boolean {
  return (campaign as { format?: string }).format === "text";
}

/** Link into the Recipients tab with a filter (from a card or count). */
export function recipientsHref(state: ReportState, filter: ReportFilter): string {
  return reportHref(state, { tab: "recipients", filter, page: 1, search: "", sendId: null });
}
