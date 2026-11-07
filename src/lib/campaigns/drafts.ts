import type { CampaignDoc, TemplateDoc } from "@/db/schema";

// Campaign drafts made from templates, and the "edit the design, then come
// back" round trip between a campaign and the Templates editor.
// Pure helpers: no database access, so they run anywhere and are unit-tested.

export type DraftTemplate = Pick<TemplateDoc, "_id" | "name" | "subject" | "previewText" | "html" | "design">;

export interface DraftSender {
  fromName: string;
  fromEmail: string;
  /** Settings reply-to ("" = none). */
  replyTo: string;
}

/** A new campaign draft using a template ("Use in campaign"): subject and preview text come from the template. */
export function draftFromTemplate(template: DraftTemplate, sender: DraftSender, id: string, now: Date): CampaignDoc {
  const subject = (template.subject ?? "").trim();
  return {
    _id: id,
    name: (subject || template.name.trim() || "Untitled campaign").slice(0, 200),
    subject,
    previewText: template.previewText?.trim() || null,
    fromName: sender.fromName,
    fromEmail: sender.fromEmail,
    replyTo: sender.replyTo.trim() || null,
    html: template.html,
    design: template.design ?? null,
    templateId: template._id,
    format: "html",
    textBody: null,
    textBodyFor: null,
    folder: null,
    archivedAt: null,
    parentId: null,
    listIds: [],
    segmentIds: [],
    abTest: null,
    status: "draft",
    scheduledAt: null,
    scheduledLocal: null,
    scheduledTimeZone: null,
    startedAt: null,
    completedAt: null,
    totalRecipients: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * What a saved template changes on the campaign it was opened from: its
 * content (and the link to the template). An empty subject / preview text is
 * filled from the template; anything the user already wrote is kept.
 */
export function templateUpdateForDraft(
  template: DraftTemplate,
  campaign: Pick<CampaignDoc, "subject" | "previewText">,
  now: Date,
): Partial<CampaignDoc> {
  const update: Partial<CampaignDoc> = {
    html: template.html,
    design: template.design ?? null,
    templateId: template._id,
    updatedAt: now,
  };
  if (!campaign.subject.trim() && template.subject?.trim()) update.subject = template.subject.trim();
  if (!campaign.previewText?.trim() && template.previewText?.trim()) update.previewText = template.previewText.trim();
  return update;
}

/** Campaign ids we accept from a URL or form (`newId()` UUIDs and older ids alike). */
const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The `?campaign=` a template was opened from, or null when missing/garbage. */
export function parseCampaignParam(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && CAMPAIGN_ID.test(raw) ? raw : null;
}

/** The template editor, opened for a campaign (it shows "Back to campaign"). */
export function templateHrefForCampaign(templateId: string, campaignId: string): string {
  return `/templates/${encodeURIComponent(templateId)}?campaign=${encodeURIComponent(campaignId)}`;
}

/** "New template" from a campaign: the new template comes back to the same campaign. */
export function newTemplateHrefForCampaign(campaignId: string): string {
  return `/templates/new?campaign=${encodeURIComponent(campaignId)}`;
}

export interface DraftStep {
  label: string;
  done: boolean;
}

/** The steps of a draft as shown in the Drafts list: subject, email, lists. */
export function draftSteps(draft: { subject: string; html: string; listCount: number }): DraftStep[] {
  return [
    { label: "Subject", done: draft.subject.trim().length > 0 },
    { label: "Email", done: draft.html.trim().length > 0 },
    { label: "Lists", done: draft.listCount > 0 },
  ];
}

/** Autosave once there is something worth keeping: a subject or a chosen template. */
export function worthAutosaving(draft: { subject: string; hasDesign: boolean }): boolean {
  return draft.subject.trim().length > 0 || draft.hasDesign;
}
