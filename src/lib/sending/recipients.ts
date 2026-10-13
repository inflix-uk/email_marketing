import type { Filter } from "mongodb";
import { collections } from "@/db";
import type { ContactDoc } from "@/db/schema";

// A campaign's audience: subscribed contacts in any of its lists. Membership
// is the embedded `contact.listIds` array, so a contact in several of the
// lists is still one document - no de-duplication needed. Served by the
// { listIds, status } index.

/** Mongo filter for the subscribed contacts of these lists. */
export function recipientsFilter(listIds: string[]): Filter<ContactDoc> {
  return { listIds: { $in: uniqueIds(listIds) }, status: "subscribed" };
}

function uniqueIds(listIds: string[]): string[] {
  return [...new Set(listIds.filter(Boolean))];
}

/** Distinct subscribed contacts across these lists. */
export async function countRecipients(listIds: string[]): Promise<number> {
  const ids = uniqueIds(listIds);
  if (ids.length === 0) return 0;
  const { contacts } = await collections();
  return contacts.countDocuments(recipientsFilter(ids));
}

/** Distinct subscribed contacts across the lists attached to a campaign. */
export async function countCampaignRecipients(campaignId: string): Promise<number> {
  const { campaigns } = await collections();
  const campaign = await campaigns.findOne({ _id: campaignId }, { projection: { listIds: 1 } });
  return campaign ? countRecipients(campaign.listIds ?? []) : 0;
}
