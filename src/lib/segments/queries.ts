import { collections } from "@/db";
import { fromDoc, type ContactStatus, type Segment, type SegmentRule } from "@/db/schema";
import { allSegmentDocs, BY_NAME, subscribedCounts, subscribedOnly, unsavedRulesFilter } from "./resolve";
import { ruleReferences, type SegmentMatch } from "./rules";
import { describeRules, type RuleNames } from "./summary";

// Read-side queries for the /segments pages. Counts happen in MongoDB.

/** Names of the lists and campaigns the rules mention (for summaries). Deleted ones are simply absent. */
export async function getRuleNames(rules: readonly SegmentRule[]): Promise<RuleNames> {
  const refs = ruleReferences(rules);
  const { lists, campaigns } = await collections();
  const [listDocs, campaignDocs] = await Promise.all([
    refs.listIds.length ? lists.find({ _id: { $in: refs.listIds } }, { projection: { name: 1 } }).toArray() : [],
    refs.campaignIds.length ? campaigns.find({ _id: { $in: refs.campaignIds } }, { projection: { name: 1 } }).toArray() : [],
  ]);
  return {
    lists: new Map(listDocs.map((d) => [d._id, d.name])),
    campaigns: new Map(campaignDocs.map((d) => [d._id, d.name])),
  };
}

export interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  /** The rules in plain English. */
  summary: string;
  /** Subscribed contacts matching right now. */
  subscribed: number;
  updatedAt: Date;
}

/** All segments with their summary and live subscribed count, alphabetically. */
export async function getSegmentsWithCounts(): Promise<SegmentRow[]> {
  const docs = await allSegmentDocs();
  if (docs.length === 0) return [];
  const [counts, names] = await Promise.all([
    subscribedCounts(docs),
    getRuleNames(docs.flatMap((d) => d.rules ?? [])),
  ]);
  return docs.map((d, i) => ({
    id: d._id,
    name: d.name,
    description: d.description ?? null,
    summary: describeRules(d.match, d.rules ?? [], names),
    subscribed: counts[i],
    updatedAt: d.updatedAt,
  }));
}

export async function getSegment(id: string): Promise<Segment | null> {
  const { segments } = await collections();
  const doc = await segments.findOne({ _id: id });
  return doc ? { ...fromDoc(doc), rules: doc.rules ?? [], match: doc.match === "any" ? "any" : "all" } : null;
}

/** How many campaigns have this segment in their audience. */
export async function countCampaignsUsingSegment(id: string): Promise<number> {
  const { campaigns } = await collections();
  return campaigns.countDocuments({ segmentIds: id });
}

// --- Rule builder options -------------------------------------------------------

export interface RuleOptions {
  lists: { id: string; name: string }[];
  tags: string[];
  campaigns: { id: string; name: string }[];
  /** Custom field names in use, e.g. ["city", "company"]. */
  fieldKeys: string[];
}

const MAX_OPTIONS = 500;
/** Custom field names are collected from the newest contacts only, to keep this cheap on big databases. */
const FIELD_KEY_SAMPLE = 5000;

/** What the rule builder's dropdowns offer: lists, tags in use, campaigns and custom field names. */
export async function getRuleOptions(): Promise<RuleOptions> {
  const { lists, contacts, campaigns } = await collections();
  const [listDocs, tags, campaignDocs, keys] = await Promise.all([
    lists.find({}, { projection: { name: 1 }, sort: { name: 1 }, collation: BY_NAME, limit: MAX_OPTIONS }).toArray(),
    contacts.distinct("tags"),
    campaigns.find({}, { projection: { name: 1 }, sort: { createdAt: -1 }, limit: MAX_OPTIONS }).toArray(),
    contacts
      .aggregate<{ _id: string }>([
        { $sort: { createdAt: -1 } },
        { $limit: FIELD_KEY_SAMPLE },
        { $project: { _id: 0, keys: { $map: { input: { $objectToArray: { $ifNull: ["$fields", {}] } }, in: "$$this.k" } } } },
        { $unwind: "$keys" },
        { $group: { _id: "$keys" } },
      ])
      .toArray(),
  ]);
  const sorted = (values: unknown[]) =>
    [...new Set(values.filter((v): v is string => typeof v === "string" && v !== ""))]
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "accent" }))
      .slice(0, MAX_OPTIONS);
  return {
    lists: listDocs.map((d) => ({ id: d._id, name: d.name })),
    tags: sorted(tags),
    campaigns: campaignDocs.map((d) => ({ id: d._id, name: d.name })),
    fieldKeys: sorted(keys.map((k) => k._id)),
  };
}

// --- Preview ----------------------------------------------------------------------

export const PREVIEW_SAMPLE_SIZE = 20;

export interface SegmentPreview {
  /** Matching contacts that can be emailed. */
  subscribed: number;
  /** Matching contacts of any status. */
  total: number;
  /** The first few matching contacts (any status), newest first. */
  sample: { id: string; email: string; name: string; status: ContactStatus }[];
}

/** Who matches a set of (possibly unsaved) rules right now. */
export async function previewRules(match: SegmentMatch, rules: readonly SegmentRule[]): Promise<SegmentPreview> {
  if (rules.length === 0) return { subscribed: 0, total: 0, sample: [] };
  const { contacts } = await collections();
  const filter = await unsavedRulesFilter(match, rules);
  const [subscribed, total, docs] = await Promise.all([
    contacts.countDocuments(subscribedOnly(filter)),
    contacts.countDocuments(filter),
    contacts
      .find(filter, {
        projection: { email: 1, firstName: 1, lastName: 1, status: 1 },
        sort: { createdAt: -1, email: 1 },
        limit: PREVIEW_SAMPLE_SIZE,
      })
      .toArray(),
  ]);
  return {
    subscribed,
    total,
    sample: docs.map((d) => ({
      id: d._id,
      email: d.email,
      name: [d.firstName, d.lastName].filter(Boolean).join(" "),
      status: d.status,
    })),
  };
}
