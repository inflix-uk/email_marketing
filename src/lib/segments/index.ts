import type { Filter } from "mongodb";
import type { ContactDoc } from "@/db/schema";

// CONTRACT (stub written by the orchestrator - the segments agent replaces the
// bodies; signatures must stay exactly as they are, other areas import them).

export interface Audience {
  listIds: string[];
  segmentIds: string[];
}

/** Mongo filter for the contacts matching one saved segment, or null if it doesn't exist. Does NOT add a status condition. */
export async function segmentContactFilter(segmentId: string): Promise<Filter<ContactDoc> | null> {
  void segmentId;
  return null;
}

/**
 * Filter for an audience: contacts in ANY of the lists OR matching ANY of the
 * segments. Does NOT add a status condition (callers add status: "subscribed").
 * Matches nothing when both arrays are empty or nothing resolves.
 */
export async function audienceFilter(audience: Audience): Promise<Filter<ContactDoc>> {
  const ids = [...new Set(audience.listIds.filter(Boolean))];
  return ids.length ? { listIds: { $in: ids } } : { _id: { $in: [] } };
}

/** Subscribed contacts in the audience. */
export async function countAudience(audience: Audience): Promise<number> {
  void audience;
  return 0;
}

/** For pickers: every segment with its current subscribed-contact count, sorted by name. */
export async function getSegmentOptions(): Promise<{ id: string; name: string; count: number }[]> {
  return [];
}

/** Create (or reuse) the segment "Did not open: <campaign name>" and return its id - used by "Resend to non-openers". */
export async function createNonOpenersSegment(campaignId: string): Promise<string> {
  void campaignId;
  throw new Error("Segments are not available yet");
}
