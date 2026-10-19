"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { collections } from "@/db";
import { fromDoc, newId, type CampaignDoc, type CampaignStatus } from "@/db/schema";
import { requireSession } from "@/lib/auth";
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
import { EDITABLE_STATUSES, existingListIds } from "./_lib/queries";
import { BLANK_HTML, CURRENT_DESIGN, parseStartingPoint } from "./_lib/starting-points";

/** Not being queued right now (queueCampaign holds a lock while it builds the send list). A stale lock from a crash doesn't count. */
function notQueueing() {
  return { $or: [{ queueLockedAt: null }, { queueLockedAt: { $lt: new Date(Date.now() - QUEUE_LOCK_STALE_MS) } }] };
}

// Campaign actions are bound to a campaign id in the page
// (`pauseSending.bind(null, id)`) and driven by useActionState. Those that need no
// form input simply omit the (prevState, formData) parameters.

export interface ActionState {
  ok?: boolean;
  message?: string;
  /** Shown instead of `message` when the action worked but needs attention. */
  warning?: string;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
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

/** ["Add a subject", "Choose a list"] -> "Add a subject; Choose a list." */
function describeProblems(problems: string[]): string {
  return `${problems.map((p) => p.trim().replace(/\.+$/, "")).join("; ")}.`;
}

function revalidateCampaigns() {
  revalidatePath("/campaigns", "layout");
}

function failure(err: unknown, fallback = "Something went wrong. Please try again."): ActionState {
  if (err instanceof CampaignError) return { error: err.message };
  console.error("[campaigns]", err);
  return { error: fallback };
}

const NOT_FOUND: ActionState = { error: "This campaign no longer exists." };

function notEditable(status: CampaignStatus): ActionState {
  return { error: `This campaign is ${status} and can no longer be changed.` };
}

/** Single-line header values: collapse any line breaks. */
const headerText = (max: number, label: string) =>
  z
    .string()
    .max(max * 2)
    .transform((v) => v.replace(/[\r\n]+/g, " ").trim())
    .refine((v) => v.length <= max, `${label} can't be longer than ${max} characters.`);

/** The content a design choice copies into a campaign. */
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
    design: template.design || null,
    templateId: template._id,
  };
}

// --- Compose: one form for new and draft campaigns ------------------------------

const INTENTS = ["save", "test", "send", "schedule"] as const;
type Intent = (typeof INTENTS)[number];

/** Shown on the campaign page after a new campaign was created (it gets its own URL). */
export type ComposeNotice = "saved" | "test-sent" | "test-failed" | "scheduled";

const composeSchema = z.object({
  subject: headerText(300, "The subject"),
  source: z.string().max(200),
  listIds: z.array(idSchema).max(500, "Choose at most 500 lists."),
});

/** Comma/space separated test addresses (default: the signed-in user). */
function parseTestAddresses(raw: string, fallback: string): { to: string[] } | { error: string } {
  const to = [
    ...new Set(
      (raw.trim() || fallback)
        .split(/[\s,;]+/)
        .map((a) => a.trim())
        .filter(Boolean)
        .map(normalizeEmail),
    ),
  ];
  if (to.length === 0) return { error: "Enter an email address for the test." };
  const invalid = to.filter((a) => !isValidEmail(a));
  if (invalid.length) return { error: `Not a valid email address: ${invalid.join(", ")}` };
  if (to.length > MAX_TEST_RECIPIENTS) return { error: `Send a test to at most ${MAX_TEST_RECIPIENTS} addresses.` };
  return { to };
}

/**
 * Save the campaign (creating it on first use), then do what the clicked button
 * asked: just save, send a test, send now or schedule. The design's content is
 * copied from the chosen template every time, so template edits reach drafts.
 */
export async function submitCampaign(
  campaignId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const intent: Intent = INTENTS.find((i) => i === text(formData, "intent")) ?? "save";

  const existing = campaignId ? await findCampaign(campaignId) : undefined;
  if (campaignId && !existing) return NOT_FOUND;
  if (existing && !EDITABLE_STATUSES.includes(existing.status)) return notEditable(existing.status);

  const parsed = composeSchema.safeParse({
    subject: text(formData, "subject"),
    source: text(formData, "source"),
    listIds: formData.getAll("listIds").filter((v): v is string => typeof v === "string"),
  });
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { subject, source } = parsed.data;
  const listIds = await existingListIds(parsed.data.listIds);

  // "current" keeps the campaign's own content (e.g. a design whose template was deleted).
  let content: Partial<Pick<CampaignDoc, "html" | "design" | "previewText" | "templateId">> = {};
  if (!(existing && source === CURRENT_DESIGN)) {
    const resolved = await resolveStartingPoint(source);
    if (!resolved) {
      return { error: "That design is no longer available.", fieldErrors: { source: ["Pick another design."] } };
    }
    content = {
      html: resolved.html,
      design: resolved.design,
      previewText: resolved.previewText,
      templateId: resolved.templateId,
    };
  }

  // Validate everything the chosen action needs before writing, so a failed
  // send doesn't leave a half-made campaign behind.
  let testTo: string[] = [];
  if (intent === "test") {
    const addresses = parseTestAddresses(text(formData, "testTo"), session.email);
    if ("error" in addresses) return { error: addresses.error, fieldErrors: { testTo: [addresses.error] } };
    testTo = addresses.to;
  }

  let when: Date | null = null;
  if (intent === "schedule") {
    const raw = text(formData, "scheduledAt");
    when = raw ? new Date(raw) : null;
    if (!when || Number.isNaN(when.getTime())) return { error: "Pick a date and time.", fieldErrors: { scheduledAt: ["Pick a date and time."] } };
    if (when.getTime() <= Date.now()) return { error: "Pick a time in the future.", fieldErrors: { scheduledAt: ["Pick a time in the future."] } };
    if (when.getTime() - Date.now() > MAX_SCHEDULE_AHEAD_MS) return { error: "You can schedule up to a year ahead." };
  }

  const settings = await getSettings();
  if (intent === "send" || intent === "schedule") {
    if (!subject) return { error: "Add a subject.", fieldErrors: { subject: ["Add a subject."] } };
    if (!settings.fromEmail) return { error: "Add your sender email in Settings first." };
    if (!(content.html ?? existing?.html ?? "").trim()) return { error: "This design is empty. Pick another one." };
    if (listIds.length === 0) return { error: "Choose who to send it to.", fieldErrors: { listIds: ["Choose at least one list."] } };
    if ((await countRecipients(listIds)) === 0) {
      return { error: "No one on these lists can receive email yet.", fieldErrors: { listIds: ["No subscribed contacts."] } };
    }
  }

  // --- Save
  const now = new Date();
  const fields = {
    name: subject || "Untitled campaign",
    subject,
    listIds,
    // Segments and A/B tests are no longer offered; clear any left over.
    segmentIds: [],
    abTest: null,
    // The sender always comes from Settings.
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo || null,
    ...content,
    updatedAt: now,
  };
  const { campaigns } = await collections();
  let id: string;
  if (existing) {
    const result = await campaigns.updateOne(
      // Guard against the worker starting the send while we were saving.
      { _id: existing.id, status: { $in: EDITABLE_STATUSES }, ...notQueueing() },
      { $set: fields },
    );
    if (result.matchedCount === 0) return { error: "This campaign has started sending, so it can no longer be changed." };
    id = existing.id;
  } else {
    const created: CampaignDoc = {
      _id: newId(),
      html: "",
      design: null,
      previewText: null,
      templateId: null,
      ...fields,
      status: "draft",
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      totalRecipients: 0,
      createdAt: now,
    };
    await campaigns.insertOne(created);
    id = created._id;
  }
  revalidateCampaigns();

  // --- Then the action
  const result = await runIntent(id, intent, { testTo, when, wasScheduled: existing?.status === "scheduled" });

  if (!existing) {
    // A new campaign now has its own page; carry the outcome over.
    const notice: ComposeNotice | null =
      intent === "save" ? "saved" : intent === "test" ? (result.ok ? "test-sent" : "test-failed") : intent === "schedule" && result.ok ? "scheduled" : null;
    redirect(`/campaigns/${id}${notice ? `?notice=${notice}` : ""}`);
  }
  return result;
}

async function runIntent(
  id: string,
  intent: Intent,
  opts: { testTo: string[]; when: Date | null; wasScheduled: boolean },
): Promise<ActionState> {
  const { campaigns } = await collections();

  if (intent === "test") {
    const campaign = await findCampaign(id);
    if (!campaign) return NOT_FOUND;
    try {
      await sendTestEmail(
        {
          subject: campaign.subject || "(no subject)",
          previewText: campaign.previewText,
          html: campaign.html,
          fromName: campaign.fromName,
          fromEmail: campaign.fromEmail,
          replyTo: campaign.replyTo,
        },
        opts.testTo,
      );
    } catch (err) {
      return { error: err instanceof Error ? err.message : "The test email couldn't be sent." };
    }
    return { ok: true, message: `Test sent to ${opts.testTo.join(", ")}.` };
  }

  if (intent === "send") {
    try {
      const { queued } = await queueCampaign(id);
      revalidateCampaigns();
      return { ok: true, message: `Sending to ${formatNumber(queued)} ${queued === 1 ? "person" : "people"}.` };
    } catch (err) {
      return failure(err, "The campaign couldn't be sent. Please try again.");
    }
  }

  if (intent === "schedule" && opts.when) {
    const result = await campaigns.updateOne(
      { _id: id, status: { $in: EDITABLE_STATUSES }, ...notQueueing() },
      { $set: { status: "scheduled", scheduledAt: opts.when, updatedAt: new Date() } },
    );
    if (result.matchedCount === 0) return { error: "This campaign has already started sending." };
    revalidateCampaigns();
    return { ok: true, message: opts.wasScheduled ? "Schedule updated." : "Scheduled." };
  }

  // Save. A scheduled campaign must stay sendable: if this edit broke it,
  // take it off the schedule instead of letting it fail at send time.
  if (opts.wasScheduled) {
    const problems = await getCampaignProblems(id);
    if (problems.length) {
      await campaigns.updateOne(
        { _id: id, status: "scheduled", ...notQueueing() },
        { $set: { status: "draft", scheduledAt: null, updatedAt: new Date() } },
      );
      revalidateCampaigns();
      return { ok: true, warning: `Saved, but taken off the schedule: ${describeProblems(problems)}` };
    }
  }
  return { ok: true, message: "Saved." };
}

/** Live "N people" for the list picker. */
export async function estimateRecipients(listIds: string[]): Promise<number> {
  await requireSession();
  const parsed = z.array(idSchema).max(500).safeParse(listIds);
  if (!parsed.success) return 0;
  const lists = [...new Set(parsed.data)];
  return lists.length ? countRecipients(lists) : 0;
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
  return { ok: true, message: "Unscheduled. It's a draft again." };
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

/** A fresh draft with the content and lists of an existing campaign. */
export async function duplicateCampaign(campaignId: string): Promise<ActionState> {
  await requireSession();
  const source = await findCampaign(campaignId);
  if (!source) return NOT_FOUND;
  const now = new Date();
  const copy: CampaignDoc = {
    _id: newId(),
    name: source.name.slice(0, 200),
    subject: source.subject,
    previewText: source.previewText,
    fromName: source.fromName,
    fromEmail: source.fromEmail,
    replyTo: source.replyTo,
    html: source.html,
    design: source.design ?? null,
    templateId: source.templateId,
    listIds: await existingListIds(source.listIds ?? []),
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
  await campaigns.insertOne(copy);

  revalidateCampaigns();
  redirect(`/campaigns/${copy._id}`);
}

export async function deleteCampaign(campaignId: string): Promise<ActionState> {
  await requireSession();
  const campaign = await findCampaign(campaignId);
  if (!campaign) return NOT_FOUND;
  if (campaign.status !== "draft") {
    return { error: "Only drafts can be deleted." };
  }

  const { campaigns, sends, clicks } = await collections();
  const result = await campaigns.deleteOne({ _id: campaign.id, status: "draft", ...notQueueing() });
  if (result.deletedCount === 0) return { error: "Only drafts can be deleted." };
  // No foreign keys: remove anything left over from an interrupted queueing.
  await Promise.all([sends.deleteMany({ campaignId: campaign.id }), clicks.deleteMany({ campaignId: campaign.id })]);

  revalidateCampaigns();
  redirect("/campaigns");
}
