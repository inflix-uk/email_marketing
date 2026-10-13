import type { Filter } from "mongodb";
import { collections } from "@/db";
import type { ContactDoc } from "@/db/schema";
import { audienceFilter } from "@/lib/segments";

// A campaign's audience: SUBSCRIBED contacts that are in any of its lists OR
// match any of its segments ("pending" contacts - unconfirmed double opt-in -
// are never emailed). A contact matching several lists/segments is still one
// document, so no de-duplication is needed.

/** Mongo filter for the subscribed contacts of these lists (lists only - see audienceRecipientsFilter). */
export function recipientsFilter(listIds: string[]): Filter<ContactDoc> {
  return { listIds: { $in: uniqueIds(listIds) }, status: "subscribed" };
}

/** Mongo filter for everyone a campaign with these lists + segments would be sent to. */
export async function audienceRecipientsFilter(
  listIds: string[],
  segmentIds: string[] = [],
): Promise<Filter<ContactDoc>> {
  const audience = await audienceFilter({ listIds: uniqueIds(listIds), segmentIds: uniqueIds(segmentIds) });
  return { $and: [audience, { status: "subscribed" }] };
}

function uniqueIds(ids: string[] | null | undefined): string[] {
  return [...new Set((ids ?? []).filter(Boolean))];
}

/** Distinct subscribed contacts in any of these lists or matching any of these segments. */
export async function countRecipients(listIds: string[], segmentIds: string[] = []): Promise<number> {
  if (uniqueIds(listIds).length === 0 && uniqueIds(segmentIds).length === 0) return 0;
  const { contacts } = await collections();
  return contacts.countDocuments(await audienceRecipientsFilter(listIds, segmentIds));
}

/** Distinct subscribed contacts in the audience (lists + segments) of a campaign. */
export async function countCampaignRecipients(campaignId: string): Promise<number> {
  const { campaigns } = await collections();
  const campaign = await campaigns.findOne({ _id: campaignId }, { projection: { listIds: 1, segmentIds: 1 } });
  return campaign ? countRecipients(campaign.listIds ?? [], campaign.segmentIds ?? []) : 0;
}
