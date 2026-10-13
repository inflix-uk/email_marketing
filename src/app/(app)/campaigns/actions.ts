"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { collections } from "@/db";
import { fromDoc, newId, type AbTest, type CampaignDoc, type CampaignStatus } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { parseDesign, renderDesign, serializeDesign } from "@/lib/email-design";
import { createNonOpenersSegment } from "@/lib/segments";
import { getSettings } from "@/lib/settings";
import {
  CampaignError,
  cancelCampaign,
  countRecipients,
  getCampaignProblems,
  pauseCampaign,
  queueCampaign,
  MAX_TEST_RECIPIENTS,
  resumeCampaign,
  sendTestEmail,
  QUEUE_LOCK_STALE_MS,
} from "@/lib/sending";
import { STARTER_TEMPLATES } from "@/lib/starter-templates";
import { formatNumber, isValidEmail, normalizeEmail } from "@/lib/utils";
import { AB_TEST_DEFAULTS } from "./_lib/ab-test";
import { EDITABLE_STATUSES, existingListIds, existingSegmentIds } from "./_lib/queries";
import { BLANK_HTML, parseStartingPoint } from "./_lib/starting-points";

/** Not being queued right now (queueCampaign holds a lock while it builds the send list). A stale lock from a crash doesn't count. */
function notQueueing() {
  return { $or: [{ queueLockedAt: null }, { queueLockedAt: { $lt: new Date(Date.now() - QUEUE_LOCK_STALE_MS) } }] };
}

// Campaign actions are bound to a campaign id in the page
// (`sendNow.bind(null, id)`) and driven by useActionState. Those that need no
// form input simply omit the (prevState, formData) parameters.

export interface ActionState {
  ok?: boolean;
  message?: string;
  /** Shown instead of `message` when the action worked but needs attention. */
  warning?: string;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export interface SaveState extends ActionState {
  savedAt?: number;
}

const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

// --- Helpers ------------------------------------------------------------------

const idSchema = z.string().trim().min(1).max(64);

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Uncached read: actions must see the current status, not a request-cached copy. */
async function findCampaign(campaignId: string) {
  const id = idSchema.safeParse(campaignId);
  if (!id.success) return undefined;
  const { campaigns } = await collections();
  const doc = await campaigns.findOne({ _id: id.data });
  return doc ? fromDoc(doc) : undefined;
}

/** ["Add a subject line", "Choose a list"] -> "Add a subject line; Choose a list." */
function describeProblems(problems: string[]): string {
  return `${problems.map((p) => p.trim().replace(/\.+$/, "")).join("; ")}.`;
}

function revalidateCampaigns() {
  revalidatePath("/campaigns", "layout");
  revalidatePath("/"); // dashboard shows recent campaigns
}

function failure(err: unknown, fallback = "Something went wrong. Please try again."): ActionState {
  if (err instanceof CampaignError) return { error: err.message };
  console.error("[campaigns]", err);
  return { error: fallback };
}

const NOT_FOUND: ActionState = { error: "This campaign no longer exists." };

function notEditable(status: CampaignStatus): ActionState {
  return { error: `This campaign is ${status} and can no longer be edited.` };
}

const optionalEmail = z
  .string()
  .trim()
  .max(254, "Email addresses can't be longer than 254 characters.")
  .refine((v) => v === "" || isValidEmail(v), "Enter a valid email address, like hello@yourdomain.com.")
  .transform((v) => (v ? normalizeEmail(v) : ""));

/** Single-line header values: collapse any line breaks. */
const headerText = (max: number, label: string) =>
  z
    .string()
    .max(max * 2)
    .transform((v) => v.replace(/[\r\n]+/g, " ").trim())
    .refine((v) => v.length <= max, `${label} can't be longer than ${max} characters.`);

// --- Create -------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().trim().min(1, "Give your campaign a name.").max(200, "Keep the name under 200 characters."),
  source: z.string().min(1, "Choose a starting point."),
});

export async function createCampaign(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const parsed = createSchema.safeParse({ name: text(formData, "name"), source: text(formData, "source") });
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const content = await resolveStartingPoint(parsed.data.source);
  if (!content) {
    return {
      error: "That starting point is no longer available.",
      fieldErrors: { source: ["Choose another template."] },
    };
  }

  const settings = await getSettings();
  const now = new Date();
  const created: CampaignDoc = {
    _id: newId(),
    name: parsed.data.name,
    ...content,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo || null,
    listIds: [],
    segmentIds: [],
    abTest: null,
    status: "draft",
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    totalRecipients: 0,
    createdAt: now,
    updatedAt: now,
  };
  const { campaigns } = await collections();
  await campaigns.insertOne(created);

  revalidateCampaigns();
  redirect(`/campaigns/${created._id}`);
}

async function resolveStartingPoint(source: string) {
  const point = parseStartingPoint(source);
  if (!point) return null;
  if (point.kind === "blank") {
    return { subject: "", previewText: null, html: BLANK_HTML, design: null, templateId: null };
  }
  if (point.kind === "starter") {
    const starter = STARTER_TEMPLATES.find((t) => t.key === point.key);
    if (!starter) return null;
    return {
      subject: starter.subject,
      previewText: starter.previewText || null,
      html: starter.html,
      // Starter designs open in the visual editor.
      design: starter.design,
      templateId: null,
    };
  }
  const { templates } = await collections();
  const template = await templates.findOne({ _id: point.id });
  if (!template) return null;
  return {
    subject: template.subject ?? "",
    previewText: template.previewText || null,
    html: template.html,
    // A template built in the visual editor stays editable there.
    design: template.design || null,
    templateId: template._id,
  };
}

// --- Save (editor) ------------------------------------------------------------

const saveSchema = z.object({
  name: z.string().trim().min(1, "Give your campaign a name.").max(200, "Keep the name under 200 characters."),
  subject: headerText(300, "The subject"),
  previewText: headerText(300, "Preview text"),
  fromName: headerText(100, "The from name"),
  fromEmail: optionalEmail,
  replyTo: optionalEmail,
  listIds: z.array(idSchema).max(500, "Choose at most 500 lists."),
  segmentIds: z.array(idSchema).max(100, "Choose at most 100 segments."),
  html: z.string().max(2_000_000, "The email is too large (over 2 MB of HTML).").optional(),
  design: z.string().max(4_000_000, "The email design is too large.").optional(),
});

const abTestSchema = z.object({
  abSubjectB: headerText(300, "Subject B").refine((v) => v.length > 0, "Add a second subject line to test."),
  abTestPercent: z.coerce
    .number("Enter a test size from 10 to 100.")
    .int("Enter a whole number from 10 to 100.")
    .min(10, "The test size must be at least 10%.")
    .max(100, "The test size can't be more than 100%."),
  abWaitHours: z.coerce
    .number("Enter a wait time from 1 to 72 hours.")
    .int("Enter a whole number of hours.")
    .min(1, "Wait at least 1 hour.")
    .max(72, "Wait at most 72 hours."),
});

type AbTestResult =
  | { ok: true; abTest: AbTest | null }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> };

/** The editor's A/B fields -> campaign.abTest (null when the test is switched off). */
function parseAbTest(formData: FormData, subject: string): AbTestResult {
  if (!text(formData, "abEnabled")) return { ok: true, abTest: null };
  const parsed = abTestSchema.safeParse({
    abSubjectB: text(formData, "abSubjectB"),
    abTestPercent: text(formData, "abTestPercent").trim() || AB_TEST_DEFAULTS.testPercent,
    abWaitHours: text(formData, "abWaitHours").trim() || AB_TEST_DEFAULTS.waitHours,
  });
  if (!parsed.success) return { ok: false, fieldErrors: z.flattenError(parsed.error).fieldErrors };
  if (parsed.data.abSubjectB.toLowerCase() === subject.toLowerCase()) {
    return { ok: false, fieldErrors: { abSubjectB: ["Subject B must be different from the subject line."] } };
  }
  return {
    ok: true,
    abTest: {
      subjectB: parsed.data.abSubjectB,
      testPercent: parsed.data.abTestPercent,
      waitHours: parsed.data.abWaitHours,
      winner: null,
      decidedAt: null,
    },
  };
}

export async function saveCampaign(campaignId: string, _prev: SaveState, formData: FormData): Promise<SaveState> {
  await requireSession();
  const campaign = await findCampaign(campaignId);
  if (!campaign) return NOT_FOUND;
  if (!EDITABLE_STATUSES.includes(campaign.status)) return notEditable(campaign.status);

  const parsed = saveSchema.safeParse({
    name: text(formData, "name"),
    subject: text(formData, "subject"),
    previewText: text(formData, "previewText"),
    fromName: text(formData, "fromName"),
    fromEmail: text(formData, "fromEmail"),
    replyTo: text(formData, "replyTo"),
    listIds: formData.getAll("listIds").filter((v): v is string => typeof v === "string"),
    segmentIds: formData.getAll("segmentIds").filter((v): v is string => typeof v === "string"),
    // Missing field = leave the content alone rather than wiping it.
    html: formData.has("html") ? text(formData, "html") : undefined,
    design: formData.has("design") ? text(formData, "design") : undefined,
  });
  // The A/B test is only touched when the form included its fields.
  const ab = formData.has("abForm") && parsed.success ? parseAbTest(formData, parsed.data.subject) : null;
  if (!parsed.success || (ab && !ab.ok)) {
    return {
      error: "Please fix the highlighted fields.",
      fieldErrors: {
        ...(parsed.success ? {} : z.flattenError(parsed.error).fieldErrors),
        ...(ab && !ab.ok ? ab.fieldErrors : {}),
      },
    };
  }
  const data = parsed.data;

  // Replace the whole selection, dropping lists and segments that have been deleted since.
  const [listIds, segmentIds] = await Promise.all([
    existingListIds(data.listIds),
    existingSegmentIds(data.segmentIds),
  ]);

  // Visual mode: the design is the source of truth. Store it in canonical form
  // and render the HTML from it on the server, so the two can never drift.
  let html = data.html;
  let design = data.design;
  if (design) {
    const parsedDesign = parseDesign(design);
    if (!parsedDesign) {
      return { error: "The visual design couldn't be read, so nothing was saved. Reload the page and try again." };
    }
    design = serializeDesign(parsedDesign);
    html = renderDesign(parsedDesign);
  }

  const { campaigns } = await collections();
  const result = await campaigns.updateOne(
    // Guard against the worker starting the send while we were saving.
    { _id: campaign.id, status: { $in: EDITABLE_STATUSES }, ...notQueueing() },
    {
      $set: {
        name: data.name,
        subject: data.subject,
        previewText: data.previewText || null,
        fromName: data.fromName,
        fromEmail: data.fromEmail,
        replyTo: data.replyTo || null,
        listIds,
        segmentIds,
        ...(html !== undefined ? { html } : {}),
        // "" = the HTML was written by hand.
        ...(design !== undefined ? { design: design || null } : {}),
        ...(ab ? { abTest: ab.abTest } : {}),
        updatedAt: new Date(),
      },
    },
  );
  if (result.matchedCount === 0) return { error: "This campaign has started sending, so it can no longer be edited." };

  revalidateCampaigns();

  // A scheduled campaign must stay sendable: if this edit broke it, take it
  // off the schedule instead of letting the worker fail at send time.
  if (campaign.status === "scheduled") {
    const problems = await getCampaignProblems(campaign.id);
    if (problems.length) {
      await campaigns.updateOne(
        { _id: campaign.id, status: "scheduled", ...notQueueing() },
        { $set: { status: "draft", scheduledAt: null, updatedAt: new Date() } },
      );
      return {
        ok: true,
        savedAt: Date.now(),
        warning: `Saved, but the campaign was unscheduled because it is no longer ready to send: ${describeProblems(problems)}`,
      };
    }
  }

  return { ok: true, savedAt: Date.now(), message: "Changes saved." };
}

/** Live "N recipients" for the audience picker. */
export async function estimateRecipients(listIds: string[], segmentIds: string[] = []): Promise<number> {
  await requireSession();
  const parsed = z
    .object({ listIds: z.array(idSchema).max(500), segmentIds: z.array(idSchema).max(100) })
    .safeParse({ listIds, segmentIds });
  if (!parsed.success) return 0;
  const lists = [...new Set(parsed.data.listIds)];
  const segments = [...new Set(parsed.data.segmentIds)];
  if (lists.length + segments.length === 0) return 0;
  return countRecipients(lists, segments);
}

// --- Test send ----------------------------------------------------------------

export async function sendTest(campaignId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const campaign = await findCampaign(campaignId);
  if (!campaign) return NOT_FOUND;

  const addresses = [
    ...new Set(
      text(formData, "to")
        .split(/[\s,;]+/)
        .map((a) => a.trim())
        .filter(Boolean)
        .map(normalizeEmail),
    ),
  ];
  if (addresses.length === 0) {
    return { error: "Enter at least one email address.", fieldErrors: { to: ["Enter at least one email address."] } };
  }
  const invalid = addresses.filter((a) => !isValidEmail(a));
  if (invalid.length) {
    const message = `Not a valid email address: ${invalid.join(", ")}`;
    return { error: message, fieldErrors: { to: [message] } };
  }
  if (addresses.length > MAX_TEST_RECIPIENTS) {
    const message = `You can send a test to at most ${MAX_TEST_RECIPIENTS} addresses at once.`;
    return { error: message, fieldErrors: { to: [message] } };
  }

  try {
    await sendTestEmail(
      {
        subject: campaign.subject,
        previewText: campaign.previewText,
        html: campaign.html,
        fromName: campaign.fromName,
        fromEmail: campaign.fromEmail,
        replyTo: campaign.replyTo,
      },
      addresses,
    );
  } catch (err) {
    if (err instanceof Error) return { error: err.message };
    return failure(err);
  }
  return { ok: true, message: `Test email sent to ${addresses.join(", ")}.` };
}

// --- Send now / schedule ------------------------------------------------------

export async function sendNow(campaignId: string): Promise<ActionState> {
  await requireSession();
  const campaign = await findCampaign(campaignId);
  if (!campaign) return NOT_FOUND;
  if (!EDITABLE_STATUSES.includes(campaign.status)) {
    return { error: `This campaign is already ${campaign.status}.` };
  }

  let queued: number;
  try {
    ({ queued } = await queueCampaign(campaign.id));
  } catch (err) {
    return failure(err, "The campaign couldn't be queued. Please try again.");
  }
  revalidateCampaigns();
  return { ok: true, message: `Sending to ${formatNumber(queued)} recipients.` };
}

const scheduleSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true, error: "Pick a valid date and time." }),
});

export async function scheduleCampaign(campaignId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const campaign = await findCampaign(campaignId);
  if (!campaign) return NOT_FOUND;
  if (!EDITABLE_STATUSES.includes(campaign.status)) {
    return { error: `This campaign is already ${campaign.status}, so it can't be scheduled.` };
  }

  const parsed = scheduleSchema.safeParse({ scheduledAt: text(formData, "scheduledAt") });
  if (!parsed.success) return { error: "Pick a valid date and time." };
  const when = new Date(parsed.data.scheduledAt);
  const now = Date.now();
  if (when.getTime() <= now) return { error: "Pick a time in the future." };
  if (when.getTime() - now > MAX_SCHEDULE_AHEAD_MS) return { error: "You can schedule up to a year ahead." };

  const problems = await getCampaignProblems(campaign.id);
  if (problems.length) {
    return { error: `Fix these before scheduling: ${describeProblems(problems)}` };
  }

  const { campaigns } = await collections();
  const result = await campaigns.updateOne(
    { _id: campaign.id, status: { $in: EDITABLE_STATUSES }, ...notQueueing() },
    { $set: { status: "scheduled", scheduledAt: when, updatedAt: new Date() } },
  );
  if (result.matchedCount === 0) return { error: "This campaign has already started sending." };

  revalidateCampaigns();
  return { ok: true, message: campaign.status === "scheduled" ? "Schedule updated." : "Campaign scheduled." };
}

export async function unscheduleCampaign(campaignId: string): Promise<ActionState> {
  await requireSession();
  const campaign = await findCampaign(campaignId);
  if (!campaign) return NOT_FOUND;

  const { campaigns } = await collections();
  const result = await campaigns.updateOne(
    { _id: campaign.id, status: "scheduled", ...notQueueing() },
    { $set: { status: "draft", scheduledAt: null, updatedAt: new Date() } },
  );
  if (result.matchedCount === 0) {
    return { error: "This campaign is no longer scheduled - it may have started sending." };
  }

  revalidateCampaigns();
  return { ok: true, message: "Campaign unscheduled. It's a draft again." };
}

// --- Sending controls ---------------------------------------------------------

async function transition(
  campaignId: string,
  allowed: CampaignStatus[],
  verb: string,
  run: (id: string) => Promise<void>,
  message: string,
): Promise<ActionState> {
  await requireSession();
  const campaign = await findCampaign(campaignId);
  if (!campaign) return NOT_FOUND;
  if (!allowed.includes(campaign.status)) {
    return { error: `A ${campaign.status} campaign can't be ${verb}.` };
  }
  try {
    await run(campaign.id);
  } catch (err) {
    return failure(err);
  }
  revalidateCampaigns();
  return { ok: true, message };
}

export async function pauseSending(campaignId: string): Promise<ActionState> {
  return transition(campaignId, ["sending"], "paused", pauseCampaign, "Sending paused.");
}

export async function resumeSending(campaignId: string): Promise<ActionState> {
  return transition(campaignId, ["paused"], "resumed", resumeCampaign, "Sending resumed.");
}

export async function cancelSending(campaignId: string): Promise<ActionState> {
  return transition(campaignId, ["scheduled", "sending", "paused"], "cancelled", cancelCampaign, "Campaign cancelled.");
}

// --- Duplicate / delete -------------------------------------------------------

/** A fresh draft with the content and sender of an existing campaign. */
function draftCopy(
  source: Omit<CampaignDoc, "_id">,
  overrides: Pick<CampaignDoc, "name" | "listIds" | "segmentIds" | "abTest">,
): CampaignDoc {
  const now = new Date();
  return {
    _id: newId(),
    subject: source.subject,
    previewText: source.previewText,
    fromName: source.fromName,
    fromEmail: source.fromEmail,
    replyTo: source.replyTo,
    html: source.html,
    design: source.design ?? null,
    templateId: source.templateId,
    ...overrides,
    name: overrides.name.slice(0, 200),
    status: "draft",
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    totalRecipients: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function duplicateCampaign(campaignId: string): Promise<ActionState> {
  await requireSession();
  const source = await findCampaign(campaignId);
  if (!source) return NOT_FOUND;
  const [listIds, segmentIds] = await Promise.all([
    existingListIds(source.listIds ?? []),
    existingSegmentIds(source.segmentIds ?? []),
  ]);
  const copy = draftCopy(source, {
    name: `Copy of ${source.name}`,
    listIds,
    segmentIds,
    // Same test set-up, no result yet.
    abTest: source.abTest ? { ...source.abTest, winner: null, decidedAt: null } : null,
  });
  const { campaigns } = await collections();
  await campaigns.insertOne(copy);

  revalidateCampaigns();
  redirect(`/campaigns/${copy._id}`);
}

/** A draft copy of a sent campaign, aimed at the people who didn't open it. */
export async function resendToNonOpeners(campaignId: string): Promise<ActionState> {
  await requireSession();
  const source = await findCampaign(campaignId);
  if (!source) return NOT_FOUND;
  if (source.status !== "sent") {
    return { error: "You can resend to non-openers once the campaign has finished sending." };
  }

  let segmentId: string;
  try {
    segmentId = await createNonOpenersSegment(source.id);
  } catch (err) {
    return failure(err, "The non-openers segment couldn't be created. Please try again.");
  }
  const copy = draftCopy(source, {
    name: `Resend: ${source.name}`,
    listIds: [],
    segmentIds: [segmentId],
    abTest: null,
  });
  const { campaigns } = await collections();
  await campaigns.insertOne(copy);

  revalidateCampaigns();
  redirect(`/campaigns/${copy._id}`);
}

export async function deleteCampaign(campaignId: string): Promise<ActionState> {
  await requireSession();
  const campaign = await findCampaign(campaignId);
  if (!campaign) return NOT_FOUND;
  if (campaign.status !== "draft") {
    return { error: "Only drafts can be deleted. Duplicate or cancel this campaign instead." };
  }

  const { campaigns, sends, clicks } = await collections();
  const result = await campaigns.deleteOne({ _id: campaign.id, status: "draft", ...notQueueing() });
  if (result.deletedCount === 0) return { error: "Only drafts can be deleted." };
  // No foreign keys: remove anything left over from an interrupted queueing.
  await Promise.all([sends.deleteMany({ campaignId: campaign.id }), clicks.deleteMany({ campaignId: campaign.id })]);

  revalidateCampaigns();
  redirect("/campaigns");
}
