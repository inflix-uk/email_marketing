import type { CollationOptions, Filter } from "mongodb";
import { collections } from "@/db";
import type { ContactDoc, SegmentDoc, SegmentRule, SendDoc } from "@/db/schema";
import { campaignActivityKey, ruleReferences, rulesFilter, type RuleContext } from "./rules";

// The database side of segment rules: look up what the pure builder in
// ./rules.ts needs, then build filters and counts. Runs in the web app and in
// the worker (no next/* imports).

/** Case-insensitive name ordering, like the lists pages. */
export const BY_NAME: CollationOptions = { locale: "en", strength: 2 };

type Activity = Extract<SegmentRule, { type: "activity" }>["activity"];

/** Which sends of a campaign count for each activity. "Did not" only looks at emails that were really sent. */
function sendFilter(campaignId: string, activity: Activity): Filter<SendDoc> {
  switch (activity) {
    case "opened":
      return { campaignId, openedAt: { $ne: null } };
    case "clicked":
      return { campaignId, clickedAt: { $ne: null } };
    case "not_opened":
      return { campaignId, status: "sent", openedAt: null };
    case "not_clicked":
      return { campaignId, status: "sent", clickedAt: null };
  }
}

/**
 * Look up everything the given rules refer to: which lists still exist, and -
 * for "opened / clicked / did not open ... a specific campaign" rules - the
 * contacts concerned.
 *
 * Size trade-off: campaign activity lives in `sends`, not on the contact, so
 * those rules are resolved to a list of contact ids that goes into the
 * contacts query as `_id: { $in: ids }`. That is one indexed read of `sends`
 * (campaignId + status) plus an indexed `_id` lookup, and it keeps the result
 * an ordinary filter that composes with $and / $or, counts and the send queue.
 * The cost is that the ids are held in memory and sent with the query: about
 * 45 bytes each, so ~4.5 MB for a campaign with 100,000 matching recipients.
 * MongoDB caps a single query at 16 MB (roughly 300,000 ids). Past that size
 * this should become a $lookup from `sends`, or a per-campaign marker stored on
 * the contact.
 */
export async function resolveRuleContext(rules: readonly SegmentRule[], now: Date = new Date()): Promise<RuleContext> {
  const refs = ruleReferences(rules);
  const existingListIds = new Set<string>();
  const campaignContactIds = new Map<string, string[]>();
  if (refs.listIds.length === 0 && refs.campaignIds.length === 0) return { now, existingListIds, campaignContactIds };

  const { lists, campaigns, sends } = await collections();
  const [listDocs, campaignDocs] = await Promise.all([
    refs.listIds.length ? lists.find({ _id: { $in: refs.listIds } }, { projection: { _id: 1 } }).toArray() : [],
    refs.campaignIds.length ? campaigns.find({ _id: { $in: refs.campaignIds } }, { projection: { _id: 1 } }).toArray() : [],
  ]);
  for (const doc of listDocs) existingListIds.add(doc._id);

  // A deleted campaign gets no entry, so its rules match nobody.
  const existingCampaigns = new Set(campaignDocs.map((doc) => doc._id));
  await Promise.all(
    refs.campaignActivities
      .filter((ref) => existingCampaigns.has(ref.campaignId))
      .map(async ({ campaignId, activity }) => {
        const docs = await sends
          .find(sendFilter(campaignId, activity), { projection: { _id: 0, contactId: 1 } })
          .toArray();
        campaignContactIds.set(
          campaignActivityKey(campaignId, activity),
          docs.map((doc) => doc.contactId),
        );
      }),
  );
  return { now, existingListIds, campaignContactIds };
}

/** Contact filters (no status condition) for several segments, with one shared lookup pass. */
export async function segmentFilters(docs: readonly Pick<SegmentDoc, "match" | "rules">[]): Promise<Filter<ContactDoc>[]> {
  const ctx = await resolveRuleContext(docs.flatMap((doc) => doc.rules ?? []));
  return docs.map((doc) => rulesFilter(doc.match, doc.rules ?? [], ctx));
}

/** Filter for unsaved rules (the live preview). */
export async function unsavedRulesFilter(match: "all" | "any", rules: readonly SegmentRule[]): Promise<Filter<ContactDoc>> {
  return rulesFilter(match, rules, await resolveRuleContext(rules));
}

/** `filter` narrowed to contacts that can be emailed. */
export function subscribedOnly(filter: Filter<ContactDoc>): Filter<ContactDoc> {
  return { $and: [filter, { status: "subscribed" }] };
}

/** Every segment, sorted by name. */
export async function allSegmentDocs(): Promise<SegmentDoc[]> {
  const { segments } = await collections();
  return segments.find({}, { sort: { name: 1 }, collation: BY_NAME }).toArray();
}

/** Subscribed-contact count of each segment, in the same order: one lookup pass, then the counts in parallel. */
export async function subscribedCounts(docs: readonly Pick<SegmentDoc, "match" | "rules">[]): Promise<number[]> {
  if (docs.length === 0) return [];
  const { contacts } = await collections();
  const filters = await segmentFilters(docs);
  return Promise.all(filters.map((filter) => contacts.countDocuments(subscribedOnly(filter))));
}
