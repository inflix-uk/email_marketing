import { collections } from "@/db";
import { newId, type CampaignStatus } from "@/db/schema";
import { QUEUE_LOCK_STALE_MS } from "@/lib/sending";
import { getSettings } from "@/lib/settings";
import { draftFromTemplate, templateUpdateForDraft } from "./drafts";

// Database side of ./drafts.ts: templates -> campaign drafts.

/** Campaigns whose content may still change (same as the campaign editor). */
const CONTENT_EDITABLE: CampaignStatus[] = ["draft", "scheduled"];

/** "Use in campaign": a new draft with the template's content. Returns its id, or null if the template is gone. */
export async function createDraftFromTemplate(templateId: string): Promise<string | null> {
  const { templates, campaigns } = await collections();
  const template = await templates.findOne({ _id: templateId });
  if (!template) return null;
  const settings = await getSettings();
  const draft = draftFromTemplate(template, settings, newId(), new Date());
  await campaigns.insertOne(draft);
  return draft._id;
}

/** A campaign the template editor was opened from (null if it is gone or no longer editable). */
export async function findEditableCampaign(campaignId: string) {
  const { campaigns } = await collections();
  return campaigns.findOne(
    { _id: campaignId, status: { $in: CONTENT_EDITABLE } },
    { projection: { name: 1, subject: 1, previewText: 1, status: 1 } },
  );
}

/**
 * Copies a (just saved) template's content into the campaign it was opened
 * from. False when the campaign is gone, already sending, or the template is gone.
 */
export async function applyTemplateToCampaign(templateId: string, campaignId: string): Promise<boolean> {
  const { templates, campaigns } = await collections();
  const [template, campaign] = await Promise.all([templates.findOne({ _id: templateId }), findEditableCampaign(campaignId)]);
  if (!template || !campaign) return false;
  const result = await campaigns.updateOne(
    {
      _id: campaignId,
      status: { $in: CONTENT_EDITABLE },
      // Not while queueCampaign is building the send list (a stale lock from a crash doesn't count).
      $or: [{ queueLockedAt: null }, { queueLockedAt: { $lt: new Date(Date.now() - QUEUE_LOCK_STALE_MS) } }],
    },
    { $set: templateUpdateForDraft(template, campaign, new Date()) },
  );
  return result.matchedCount > 0;
}
