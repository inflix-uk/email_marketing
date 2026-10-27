// Database side of the single-campaign report. Every count is computed in
// MongoDB (aggregation / countDocuments); only small grouped results and one
// page of recipients come back to JS.
//
// One definition per recipient filter (filterExpr) is used both for the
// numbers on the cards and for the Recipients tab, so a card's count always
// matches the list it links to.
//
// "Raw" numbers include every recorded hit. With hideBots, opens/clicks from
// suspected bots (scanners, clicks within 2 s of sending) and Apple Mail
// privacy-proxy opens are left out, using the per-send bot counters.
// Older data has no bot counters (missing = 0): bots weren't recorded then.
//
// Test emails never create sends, so they are never in these numbers.

import type { Document, Filter, Sort } from "mongodb";
import { collections } from "@/db";
import type { SendDoc, SendStatus } from "@/db/schema";
import { classifyUserAgent, countryName } from "./user-agent";
import { isSystemLink } from "./links";
import { computeMetrics, type CampaignMetrics, type MetricCounts } from "./metrics";
import { bucketsBetween, chooseUnit, MONGO_BUCKET_FORMAT, REPORT_TIME_ZONE, type BucketUnit } from "./time-buckets";

export interface ReportOptions {
  hideBots: boolean;
}

// ---------------------------------------------------------------------------
// Filters (shared by cards and the Recipients tab)
// ---------------------------------------------------------------------------

export const REPORT_FILTERS = [
  "all",
  "opened",
  "clicked",
  "not_opened",
  "bounced",
  "unsubscribed",
  "complained",
  "failed",
] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number];

export const REPORT_FILTER_LABELS: Record<ReportFilter, string> = {
  all: "All",
  opened: "Opened",
  clicked: "Clicked",
  not_opened: "Not opened",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  complained: "Complained",
  failed: "Failed",
};

export function parseReportFilter(value: string | undefined): ReportFilter {
  return REPORT_FILTERS.find((f) => f === value) ?? "all";
}

const n0 = (field: string) => ({ $ifNull: [field, 0] });
const isSet = (field: string) => ({ $ne: [{ $ifNull: [field, null] }, null] });
const humanOpens = { $subtract: [n0("$openCount"), n0("$botOpenCount")] };
const humanClicks = { $subtract: [n0("$clickCount"), n0("$botClickCount")] };

function openedExpr(o: ReportOptions): Document {
  return o.hideBots ? { $gt: [humanOpens, 0] } : isSet("$openedAt");
}
function clickedExpr(o: ReportOptions): Document {
  return o.hideBots ? { $gt: [humanClicks, 0] } : isSet("$clickedAt");
}

/** The aggregation predicate of a filter (true/false per send). */
export function filterExpr(filter: ReportFilter, o: ReportOptions): Document {
  switch (filter) {
    case "opened":
      return openedExpr(o);
    case "clicked":
      return clickedExpr(o);
    case "not_opened":
      return { $and: [{ $eq: ["$status", "sent"] }, { $not: [openedExpr(o)] }] };
    case "bounced":
      return { $or: [isSet("$bouncedAt"), isSet("$softBouncedAt")] };
    case "unsubscribed":
      return isSet("$unsubscribedAt");
    case "complained":
      return isSet("$complainedAt");
    case "failed":
      return { $in: ["$status", ["failed", "skipped"]] };
    default:
      return { $literal: true };
  }
}

const countIf = (cond: Document) => ({ $sum: { $cond: [cond, 1, 0] } });

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface ReportSummary {
  total: number;
  queued: number;
  sending: number;
  /** S: accepted by the mail server. */
  sent: number;
  uniqueOpens: number;
  totalOpens: number;
  uniqueClicks: number;
  totalClicks: number;
  hardBounces: number;
  softBounces: number;
  acceptedHardBounces: number;
  unsubscribes: number;
  complaints: number;
  /** Count per filter - the numbers shown on the Recipients tabs. */
  filters: Record<ReportFilter, number>;
  /** Opens/clicks flagged as suspected bots or privacy-proxy opens (raw minus filtered). */
  botOpens: number;
  botClicks: number;
  metrics: CampaignMetrics;
}

export async function getReportSummary(campaignId: string, o: ReportOptions): Promise<ReportSummary> {
  const { sends } = await collections();
  const filterGroups = Object.fromEntries(REPORT_FILTERS.map((f) => [`f_${f}`, countIf(filterExpr(f, o))]));
  const row = await sends
    .aggregate<Record<string, number>>(
      [
        { $match: { campaignId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            queued: countIf({ $eq: ["$status", "queued"] }),
            sending: countIf({ $eq: ["$status", "sending"] }),
            sent: countIf({ $eq: ["$status", "sent"] }),
            uniqueOpens: countIf(openedExpr(o)),
            uniqueClicks: countIf(clickedExpr(o)),
            rawOpens: { $sum: n0("$openCount") },
            rawClicks: { $sum: n0("$clickCount") },
            botOpens: { $sum: n0("$botOpenCount") },
            botClicks: { $sum: n0("$botClickCount") },
            hardBounces: countIf(isSet("$bouncedAt")),
            acceptedHardBounces: countIf({ $and: [isSet("$bouncedAt"), { $eq: ["$status", "sent"] }] }),
            softBounces: countIf({ $and: [isSet("$softBouncedAt"), { $not: [isSet("$bouncedAt")] }] }),
            unsubscribes: countIf(isSet("$unsubscribedAt")),
            complaints: countIf(isSet("$complainedAt")),
            ...filterGroups,
          },
        },
      ],
      { allowDiskUse: true },
    )
    .next();
  const v = (k: string) => Number(row?.[k] ?? 0);
  const counts: MetricCounts = {
    sent: v("sent"),
    uniqueOpens: v("uniqueOpens"),
    totalOpens: o.hideBots ? Math.max(0, v("rawOpens") - v("botOpens")) : v("rawOpens"),
    uniqueClicks: v("uniqueClicks"),
    totalClicks: o.hideBots ? Math.max(0, v("rawClicks") - v("botClicks")) : v("rawClicks"),
    hardBounces: v("hardBounces"),
    softBounces: v("softBounces"),
    acceptedHardBounces: v("acceptedHardBounces"),
    unsubscribes: v("unsubscribes"),
    complaints: v("complaints"),
  };
  return {
    ...counts,
    acceptedHardBounces: v("acceptedHardBounces"),
    total: v("total"),
    queued: v("queued"),
    sending: v("sending"),
    filters: Object.fromEntries(REPORT_FILTERS.map((f) => [f, v(`f_${f}`)])) as Record<ReportFilter, number>,
    botOpens: v("botOpens"),
    botClicks: v("botClicks"),
    metrics: computeMetrics(counts),
  };
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

export const REPORT_PAGE_SIZE = 50;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The sends query of the Recipients tab (and its CSV export). */
export async function recipientsQuery(
  campaignId: string,
  filter: ReportFilter,
  search: string,
  o: ReportOptions,
): Promise<Filter<SendDoc>> {
  const query: Filter<SendDoc> = { campaignId };
  if (filter !== "all") query.$expr = filterExpr(filter, o);
  const q = search.trim().slice(0, 100);
  if (q) {
    const re = new RegExp(escapeRegex(q), "i");
    // Names live on the contact: match them there (bounded), then by contact id.
    const { contacts } = await collections();
    const byName = await contacts
      .find({ $or: [{ firstName: re }, { lastName: re }] }, { projection: { _id: 1 } })
      .limit(1000)
      .toArray();
    query.$or = [{ email: re }, ...(byName.length ? [{ contactId: { $in: byName.map((c) => c._id) } }] : [])];
  }
  return query;
}

export interface ReportRecipient {
  id: string;
  contactId: string;
  email: string;
  name: string;
  status: SendStatus;
  delivery: string;
  lastError: string | null;
  opens: number;
  clicks: number;
  unsubscribed: boolean;
  complained: boolean;
  lastActivityAt: Date | null;
}

const RECIPIENT_PROJECTION = {
  contactId: 1,
  email: 1,
  status: 1,
  lastError: 1,
  sentAt: 1,
  openedAt: 1,
  clickedAt: 1,
  unsubscribedAt: 1,
  bouncedAt: 1,
  softBouncedAt: 1,
  complainedAt: 1,
  openCount: 1,
  clickCount: 1,
  botOpenCount: 1,
  botClickCount: 1,
  lastActivityAt: 1,
  variant: 1,
} as const;

type RecipientDoc = Pick<
  SendDoc,
  | "_id"
  | "contactId"
  | "email"
  | "status"
  | "lastError"
  | "sentAt"
  | "openedAt"
  | "clickedAt"
  | "unsubscribedAt"
  | "bouncedAt"
  | "softBouncedAt"
  | "complainedAt"
  | "openCount"
  | "clickCount"
  | "botOpenCount"
  | "botClickCount"
  | "lastActivityAt"
  | "variant"
>;

/** "Sent", "Hard bounce", "Soft bounce", "Failed", "Skipped", "Waiting", "Sending". */
export function deliveryLabel(s: Pick<SendDoc, "status" | "bouncedAt" | "softBouncedAt">): string {
  if (s.bouncedAt) return "Hard bounce";
  switch (s.status) {
    case "sent":
      return s.softBouncedAt ? "Soft bounce" : "Sent";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "sending":
      return "Sending";
    default:
      return "Waiting";
  }
}

function latest(...dates: (Date | null | undefined)[]): Date | null {
  let best: Date | null = null;
  for (const d of dates) if (d && (!best || d > best)) best = d;
  return best;
}

export function toRecipient(d: RecipientDoc, name: string, o: ReportOptions): ReportRecipient {
  const opens = d.openCount ?? 0;
  const clicks = d.clickCount ?? 0;
  return {
    id: d._id,
    contactId: d.contactId,
    email: d.email,
    name,
    status: d.status,
    delivery: deliveryLabel(d),
    lastError: d.lastError ?? null,
    opens: o.hideBots ? Math.max(0, opens - (d.botOpenCount ?? 0)) : opens,
    clicks: o.hideBots ? Math.max(0, clicks - (d.botClickCount ?? 0)) : clicks,
    unsubscribed: Boolean(d.unsubscribedAt),
    complained: Boolean(d.complainedAt),
    lastActivityAt: latest(
      d.lastActivityAt,
      d.openedAt,
      d.clickedAt,
      d.unsubscribedAt,
      d.complainedAt,
      d.bouncedAt,
      d.softBouncedAt,
      d.sentAt,
    ),
  };
}

/** "Jane Doe" for each contact id (missing contacts are skipped). */
export async function contactNames(contactIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(contactIds)];
  if (ids.length === 0) return new Map();
  const { contacts } = await collections();
  const docs = await contacts
    .find({ _id: { $in: ids } }, { projection: { firstName: 1, lastName: 1 } })
    .toArray();
  return new Map(docs.map((c) => [c._id, [c.firstName, c.lastName].filter(Boolean).join(" ")]));
}

export async function getReportRecipients(
  campaignId: string,
  input: { filter: ReportFilter; search: string; page: number },
  o: ReportOptions,
): Promise<{ rows: ReportRecipient[]; total: number; page: number; pageCount: number }> {
  const { sends } = await collections();
  const query = await recipientsQuery(campaignId, input.filter, input.search, o);
  const total = await sends.countDocuments(query);
  const pageCount = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE));
  const page = Math.min(Math.max(1, input.page), pageCount);
  // `_id` last keeps pagination stable when the sort keys tie.
  const sort: Sort =
    input.filter === "opened"
      ? { openedAt: -1, _id: 1 }
      : input.filter === "clicked"
        ? { clickedAt: -1, _id: 1 }
        : { sentAt: -1, email: 1, _id: 1 };
  const docs = await sends
    .find<RecipientDoc>(query, { projection: RECIPIENT_PROJECTION })
    .sort(sort)
    .skip((page - 1) * REPORT_PAGE_SIZE)
    .limit(REPORT_PAGE_SIZE)
    .toArray();
  const names = await contactNames(docs.map((d) => d.contactId));
  return { rows: docs.map((d) => toRecipient(d, names.get(d.contactId) ?? "", o)), total, page, pageCount };
}

export { RECIPIENT_PROJECTION, type RecipientDoc };

// ---------------------------------------------------------------------------
// One recipient's timeline
// ---------------------------------------------------------------------------

export interface TimelineEvent {
  at: Date;
  label: string;
  detail?: string;
  /** Suspected bot / Apple privacy proxy. */
  flag?: string;
}

const MAX_TIMELINE_EVENTS = 100;

export async function getRecipientTimeline(
  campaignId: string,
  sendId: string,
  o: ReportOptions,
): Promise<{ email: string; events: TimelineEvent[] } | null> {
  const { sends, opens, clicks } = await collections();
  const send = await sends.findOne({ _id: sendId, campaignId });
  if (!send) return null;
  const botFilter = o.hideBots ? { suspectedBot: { $ne: true } } : {};
  const [openDocs, clickDocs] = await Promise.all([
    opens
      .find({ sendId, ...botFilter, ...(o.hideBots ? { privacyProxy: { $ne: true } } : {}) })
      .sort({ createdAt: 1 })
      .limit(MAX_TIMELINE_EVENTS)
      .toArray(),
    clicks.find({ sendId, ...botFilter }).sort({ createdAt: 1 }).limit(MAX_TIMELINE_EVENTS).toArray(),
  ]);

  const events: TimelineEvent[] = [];
  if (send.sentAt) events.push({ at: send.sentAt, label: "Sent" });
  if (send.status === "failed" || send.status === "skipped") {
    events.push({ at: send.updatedAt, label: send.status === "failed" ? "Failed" : "Skipped", detail: send.lastError ?? undefined });
  }
  if (openDocs.length) {
    for (const e of openDocs) {
      const flag = e.suspectedBot ? "Suspected bot" : e.privacyProxy ? "Apple privacy (automatic)" : undefined;
      events.push({ at: e.createdAt, label: "Opened", flag });
    }
  } else if (send.openedAt) {
    // Older data: only the first open time is known.
    events.push({ at: send.openedAt, label: "Opened", detail: "first open" });
  }
  for (const e of clickDocs) {
    events.push({ at: e.createdAt, label: "Clicked a link", detail: e.url, flag: e.suspectedBot ? "Suspected bot" : undefined });
  }
  if (send.unsubscribedAt) events.push({ at: send.unsubscribedAt, label: "Unsubscribed" });
  if (send.bouncedAt) events.push({ at: send.bouncedAt, label: "Bounced (hard)", detail: send.lastError ?? undefined });
  if (send.softBouncedAt) events.push({ at: send.softBouncedAt, label: "Bounced (soft)" });
  if (send.complainedAt) events.push({ at: send.complainedAt, label: "Marked as spam" });
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { email: send.email, events };
}

// ---------------------------------------------------------------------------
// Activity over time
// ---------------------------------------------------------------------------

export interface Activity {
  unit: BucketUnit;
  timeZone: string;
  /** "all": every recorded open; "first": first open per person (older campaigns). */
  opensKind: "all" | "first";
  buckets: { key: string; label: string; opens: number; clicks: number }[];
}

const MAX_BUCKETS = 120;

export async function getActivity(campaignId: string, o: ReportOptions, until: Date = new Date()): Promise<Activity | null> {
  const { sends, opens, clicks } = await collections();
  const [first, lastOpen, lastClick, anyOpenEvent] = await Promise.all([
    sends
      .aggregate<{ at: Date | null; lastOpen: Date | null }>([
        { $match: { campaignId, sentAt: { $ne: null } } },
        { $group: { _id: null, at: { $min: "$sentAt" }, lastOpen: { $max: "$openedAt" } } },
      ])
      .next(),
    opens.find({ campaignId }, { projection: { createdAt: 1 } }).sort({ createdAt: -1 }).limit(1).next(),
    clicks.find({ campaignId }, { projection: { createdAt: 1 } }).sort({ createdAt: -1 }).limit(1).next(),
    opens.findOne({ campaignId }, { projection: { _id: 1 } }),
  ]);
  if (!first?.at) return null;
  const start = first.at;
  const lastActivity = [first.lastOpen, lastOpen?.createdAt, lastClick?.createdAt, start]
    .filter((d): d is Date => Boolean(d))
    .reduce((a, b) => (a > b ? a : b));
  const end = lastActivity > until ? until : lastActivity;
  const unit = chooseUnit(start, end);
  const buckets = bucketsBetween(start, end, unit, MAX_BUCKETS);
  if (buckets.length === 0) return null;
  const last = buckets[buckets.length - 1];
  const rangeEnd = new Date(Math.max(end.getTime(), last.start.getTime()) + (unit === "hour" ? 3_600_000 : 86_400_000));

  const keyOf = (field: string) => ({
    $dateToString: { date: `$${field}`, format: MONGO_BUCKET_FORMAT[unit], timezone: REPORT_TIME_ZONE },
  });
  const perBucket = (match: Document, field: string): Document[] => [
    { $match: { campaignId, [field]: { $gte: start, $lt: rangeEnd }, ...match } },
    { $group: { _id: keyOf(field), n: { $sum: 1 } } },
  ];
  const opensKind = anyOpenEvent ? "all" : "first";
  const [openRows, clickRows] = await Promise.all([
    opensKind === "all"
      ? opens
          .aggregate<{ _id: string; n: number }>(
            perBucket(o.hideBots ? { suspectedBot: { $ne: true }, privacyProxy: { $ne: true } } : {}, "createdAt"),
          )
          .toArray()
      : sends.aggregate<{ _id: string; n: number }>(perBucket({}, "openedAt")).toArray(),
    clicks
      .aggregate<{ _id: string; n: number }>(perBucket(o.hideBots ? { suspectedBot: { $ne: true } } : {}, "createdAt"))
      .toArray(),
  ]);
  const opensBy = new Map(openRows.map((r) => [r._id, r.n]));
  const clicksBy = new Map(clickRows.map((r) => [r._id, r.n]));
  return {
    unit,
    timeZone: REPORT_TIME_ZONE,
    opensKind,
    buckets: buckets.map((b) => ({ key: b.key, label: b.label, opens: opensBy.get(b.key) ?? 0, clicks: clicksBy.get(b.key) ?? 0 })),
  };
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export interface LinkStat {
  url: string;
  clicks: number;
  uniqueClickers: number;
}

const MAX_LINKS = 500;

/** Clicked links, most-clicked first, without unsubscribe / system links. */
export async function getLinkStats(campaignId: string, o: ReportOptions, appUrl: string | null): Promise<LinkStat[]> {
  const { clicks } = await collections();
  const rows = await clicks
    .aggregate<LinkStat>(
      [
        { $match: { campaignId, ...(o.hideBots ? { suspectedBot: { $ne: true } } : {}) } },
        // Per (url, send) first, so unique clickers never need a big in-memory set.
        { $group: { _id: { url: "$url", sendId: "$sendId" }, n: { $sum: 1 } } },
        { $group: { _id: "$_id.url", clicks: { $sum: "$n" }, uniqueClickers: { $sum: 1 } } },
        { $sort: { clicks: -1, _id: 1 } },
        { $limit: MAX_LINKS },
        { $project: { _id: 0, url: "$_id", clicks: 1, uniqueClickers: 1 } },
      ],
      { allowDiskUse: true },
    )
    .toArray();
  return rows.filter((r) => !isSystemLink(r.url, appUrl));
}

// ---------------------------------------------------------------------------
// Devices & location
// ---------------------------------------------------------------------------

export interface Breakdown {
  name: string;
  count: number;
}

export interface DeviceStats {
  devices: Breakdown[];
  clients: Breakdown[];
  countries: Breakdown[];
  /** Opens with a stored event (newer data) vs all opens counted on the sends. */
  openEvents: number;
  totalOpens: number;
  /** Opens + clicks events, and how many of them carried a country header. */
  events: number;
  eventsWithCountry: number;
}

const MAX_AGENTS = 2000;

function addTo(map: Map<string, number>, key: string, n: number) {
  map.set(key, (map.get(key) ?? 0) + n);
}

const sorted = (map: Map<string, number>): Breakdown[] =>
  [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

export async function getDeviceStats(campaignId: string, o: ReportOptions, totalOpens: number): Promise<DeviceStats> {
  const { opens, clicks } = await collections();
  const openMatch = { campaignId, ...(o.hideBots ? { suspectedBot: { $ne: true }, privacyProxy: { $ne: true } } : {}) };
  const clickMatch = { campaignId, ...(o.hideBots ? { suspectedBot: { $ne: true } } : {}) };
  const byField = (field: string): Document[] => [
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: MAX_AGENTS },
  ];
  const [agents, openCountries, clickCountries] = await Promise.all([
    opens.aggregate<{ _id: string | null; n: number }>([{ $match: openMatch }, ...byField("userAgent")]).toArray(),
    opens.aggregate<{ _id: string | null; n: number }>([{ $match: openMatch }, ...byField("country")]).toArray(),
    clicks.aggregate<{ _id: string | null; n: number }>([{ $match: clickMatch }, ...byField("country")]).toArray(),
  ]);

  const devices = new Map<string, number>();
  const clients = new Map<string, number>();
  let openEvents = 0;
  for (const row of agents) {
    const info = classifyUserAgent(row._id);
    addTo(devices, info.device, row.n);
    addTo(clients, info.client, row.n);
    openEvents += row.n;
  }
  const countries = new Map<string, number>();
  let events = 0;
  let eventsWithCountry = 0;
  for (const row of [...openCountries, ...clickCountries]) {
    events += row.n;
    if (row._id) eventsWithCountry += row.n;
    addTo(countries, row._id ? countryName(row._id) : "Unknown", row.n);
  }
  return {
    devices: sorted(devices),
    clients: sorted(clients),
    countries: sorted(countries),
    openEvents,
    totalOpens,
    events,
    eventsWithCountry,
  };
}
