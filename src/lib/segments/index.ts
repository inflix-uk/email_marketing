import type { Filter } from "mongodb";
import { collections } from "@/db";
import { newId, type ContactDoc, type SegmentRule } from "@/db/schema";
import { allSegmentDocs, segmentFilters, subscribedCounts, subscribedOnly } from "./resolve";
import { nobody } from "./rules";

// Segments: saved, live filters over contacts. This file is the contract the
// rest of the app uses (campaign audience pickers, the send queue, "resend to
// non-openers"); the signatures must stay as they are.
//   ./rules.ts     rule -> MongoDB filter builder and zod validation (pure)
//   ./resolve.ts   database lookups the rules need
//   ./queries.ts, ./mutations.ts, ./summary.ts   the /segments pages

export interface Audience {
  listIds: string[];
  segmentIds: string[];
}

/** Mongo filter for the contacts matching one saved segment, or null if it doesn't exist. Does NOT add a status condition. */
export async function segmentContactFilter(segmentId: string): Promise<Filter<ContactDoc> | null> {
  if (!segmentId) return null;
  const { segments } = await collections();
  const doc = await segments.findOne({ _id: segmentId });
  if (!doc) return null;
  const [filter] = await segmentFilters([doc]);
  return filter;
}

/**
 * Filter for an audience: contacts in ANY of the lists OR matching ANY of the
 * segments. Does NOT add a status condition (callers add status: "subscribed").
 * Matches nothing when both arrays are empty or nothing resolves.
 *
 * It is a single filter, so a contact who is on a list and also matches a
 * segment is found (and counted) once.
 */
export async function audienceFilter(audience: Audience): Promise<Filter<ContactDoc>> {
  const listIds = [...new Set((audience.listIds ?? []).filter(Boolean))];
  const segmentIds = [...new Set((audience.segmentIds ?? []).filter(Boolean))];

  const clauses: Filter<ContactDoc>[] = [];
  if (listIds.length) clauses.push({ listIds: { $in: listIds } });
  if (segmentIds.length) {
    const { segments } = await collections();
    // Segments that were deleted simply aren't found and add nothing.
    const docs = await segments.find({ _id: { $in: segmentIds } }).toArray();
    clauses.push(...(await segmentFilters(docs)));
  }

  if (clauses.length === 0) return nobody();
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

/** Subscribed contacts in the audience. */
export async function countAudience(audience: Audience): Promise<number> {
  const { contacts } = await collections();
  return contacts.countDocuments(subscribedOnly(await audienceFilter(audience)));
}

/** For pickers: every segment with its current subscribed-contact count, sorted by name. */
export async function getSegmentOptions(): Promise<{ id: string; name: string; count: number }[]> {
  const docs = await allSegmentDocs();
  const counts = await subscribedCounts(docs);
  return docs.map((doc, i) => ({ id: doc._id, name: doc.name, count: counts[i] }));
}

const MAX_NAME_LENGTH = 120;

/** Create (or reuse) the segment "Did not open: <campaign name>" and return its id - used by "Resend to non-openers". */
export async function createNonOpenersSegment(campaignId: string): Promise<string> {
  const { campaigns, segments } = await collections();
  const campaign = campaignId ? await campaigns.findOne({ _id: campaignId }, { projection: { name: 1 } }) : null;
  if (!campaign) throw new Error("This campaign no longer exists, so its non-openers can't be found.");

  // Reuse the segment made earlier for this campaign - but only while it still
  // has this name and exactly the one "did not open <this campaign>" rule. If
  // someone renamed it or changed its rules it is theirs now, and a new one is made.
  const name = `Did not open: ${campaign.name}`.slice(0, MAX_NAME_LENGTH);
  const existing = await segments.findOne(
    {
      name,
      rules: { $size: 1 },
      "rules.0.type": "activity",
      "rules.0.activity": "not_opened",
      "rules.0.scope": "campaign",
      "rules.0.campaignId": campaignId,
    },
    { projection: { _id: 1 }, sort: { createdAt: 1 } },
  );
  if (existing) return existing._id;

  const rule: SegmentRule = { type: "activity", activity: "not_opened", scope: "campaign", campaignId };
  const id = newId();
  const now = new Date();
  await segments.insertOne({
    _id: id,
    name,
    description: "People who were sent this campaign and haven't opened it. Made by “Resend to non-openers”.",
    match: "all",
    rules: [rule],
    createdAt: now,
    updatedAt: now,
  });
  return id;
}
