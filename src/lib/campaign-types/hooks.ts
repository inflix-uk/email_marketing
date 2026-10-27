// Small pure hooks the sending engine (src/lib/sending) calls for typed
// campaigns. Kept free of database access so queue.ts / process.ts can import
// them without an import cycle.

import type { CampaignDoc, CampaignType, VariantKey } from "@/db/schema";
import { allocateVariant, HELD_UNTIL, variantTestProblems, variantTestStartFields } from "./ab-test";
import { resendDueAt } from "./resend-rules";

export { contentForVariant } from "./ab-test";

export function campaignType(campaign: Pick<CampaignDoc, "type"> | null | undefined): CampaignType {
  const t = campaign?.type;
  return t === "ab" || t === "resend" || t === "rss" ? t : "regular";
}

type TypedCampaign = Pick<CampaignDoc, "type" | "variantTest" | "resend" | "rss">;

/** Extra reasons a typed campaign can't be queued (getCampaignProblems). */
export function campaignTypeProblems(campaign: TypedCampaign): string[] {
  switch (campaignType(campaign)) {
    case "ab":
      return variantTestProblems(campaign.variantTest);
    case "rss":
      // A series is started on its page; each run is queued as its own (regular) campaign.
      return ["An RSS series isn't sent directly - start the series instead"];
    default:
      return [];
  }
}

/**
 * Per-contact queue decision while queueCampaign streams the audience:
 * the A/B variant (and a held-back time for the remainder). null = nothing special.
 */
export function createTypeAllocator(
  campaignId: string,
  campaign: TypedCampaign,
): ((contactId: string) => { variant: VariantKey | null; nextAttemptAt?: Date }) | null {
  if (campaignType(campaign) !== "ab" || !campaign.variantTest) return null;
  const test = campaign.variantTest;
  return (contactId) => {
    const variant = allocateVariant(campaignId, contactId, test);
    return variant ? { variant } : { variant: null, nextAttemptAt: HELD_UNTIL };
  };
}

/** Fields queueCampaign sets on the campaign when it starts sending. */
export function campaignTypeStartFields(campaign: TypedCampaign, startedAt: Date): Record<string, unknown> {
  const type = campaignType(campaign);
  if (type === "ab" && campaign.variantTest) return variantTestStartFields(campaign.variantTest, startedAt);
  if (type === "resend" && campaign.resend) {
    return {
      "resend.state": "waiting",
      "resend.dueAt": resendDueAt(startedAt, campaign.resend.delayHours),
      "resend.claimedAt": null,
      "resend.childId": null,
      "resend.resentAt": null,
      "resend.resendCount": 0,
      "resend.note": null,
    };
  }
  return {};
}
