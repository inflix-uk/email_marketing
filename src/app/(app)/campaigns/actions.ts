"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { collections } from "@/db";
import { CAMPAIGN_FORMATS, fromDoc, newId, type Campaign, type CampaignDoc, type CampaignStatus } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requirePermission, requireSession } from "@/lib/auth";
import { ARCHIVABLE_STATUSES, normalizeFolder } from "@/lib/campaigns/workspace";
import { can } from "@/lib/permissions";
import { contentFingerprint } from "@/lib/plain-text";
import { checkSchedule } from "@/lib/schedule";
import { parseCampaignTypeFields, runCampaignTypeIntent } from "@/lib/campaign-types/form";
import { getSettings } from "@/lib/settings";
import { senderFromSettings } from "@/lib/sending/sender";
import {
  CampaignError,
  cancelCampaign,
  countRecipients,
  getCampaignProblems,
  hasLineBreak,
  sendBlockers,
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

const MAX_PREVIEW_TEXT = 250;
const MAX_TEXT_BODY = 100_000;

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

interface ScheduleChoice {
  at: Date;
  local: string;
  timeZone: string;
}

/** Shown on the campaign page after a new campaign was created (it gets its own URL). */
export type ComposeNotice = "saved" | "created" | "design-saved" | "test-sent" | "test-failed" | "scheduled";

const composeSchema = z.object({
  subject: headerText(300, "The subject"),
  name: headerText(200, "The campaign name"),
  previewText: headerText(MAX_PREVIEW_TEXT, "The preview text"),
  // Reply-to goes into a header: reject line breaks outright (header injection).
  replyTo: z
    .string()
    .max(320)
    .refine((v) => !hasLineBreak(v), "The reply-to address can't contain line breaks.")
    .transform((v) => normalizeEmail(v))
    .refine((v) => !v || isValidEmail(v), "Enter a valid reply-to email address."),
  format: z.enum(CAMPAIGN_FORMATS),
  textBody: z
    .string()
    .max(MAX_TEXT_BODY * 2)
    .transform((v) => v.replace(/\r\n?/g, "\n").trim())
    .refine((v) => v.length <= MAX_TEXT_BODY, `The plain-text version can't be longer than ${MAX_TEXT_BODY} characters.`),
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
  const session = await requirePermission("edit");
  const intent: Intent = INTENTS.find((i) => i === text(formData, "intent")) ?? "save";
  if (intent !== "save" && !can(session.role, "send")) return { error: "Your role can't send campaigns." };

  // A new campaign that autosave already created carries its id in the form.
  const id = campaignId ?? (idSchema.safeParse(text(formData, "campaignId")).data || null);
  const existing = id ? await findCampaign(id) : undefined;
  if (id && !existing) return NOT_FOUND;
  // A second "Send" (double click, retry after a slow response) is not an error: it already went out.
  if (existing && intent === "send" && ["sending", "paused", "sent"].includes(existing.status)) {
    return { ok: true, message: "This campaign is already sending." };
  }
  if (existing && !EDITABLE_STATUSES.includes(existing.status)) return notEditable(existing.status);

  const saved = await saveCompose(existing, intent, formData, session.email);
  if (!("savedId" in saved)) return saved;
  revalidateCampaigns();
  const { savedId, testTo, schedule, subject } = saved;

  // --- Then the action
  const result =
    (await runCampaignTypeIntent(savedId, intent, schedule?.at ?? null)) ??
    (await runIntent(savedId, intent, { testTo, schedule, wasScheduled: existing?.status === "scheduled" }));
  if (result.ok && (intent === "send" || intent === "schedule")) {
    await audit(session, `campaign.${intent}`, {
      type: "campaign",
      id: savedId,
      details: { subject, scheduledAt: intent === "schedule" ? (schedule?.at ?? null) : null },
    });
  }

  // A campaign started on /campaigns/new (even if autosave already created it)
  // now has its own page; carry the outcome over.
  if (!existing || text(formData, "startedNew") === "1") {
    const notice: ComposeNotice | null =
      intent === "save" ? "saved" : intent === "test" ? (result.ok ? "test-sent" : "test-failed") : intent === "schedule" && result.ok ? "scheduled" : null;
    redirect(`/campaigns/${savedId}${notice ? `?notice=${notice}` : ""}`);
  }
  return result;
}

export interface AutosaveResult {
  ok?: boolean;
  /** The campaign's id (new on the first autosave of a new campaign). */
  id?: string;
  error?: string;
}

/**
 * Quietly saves a draft while it is being written (debounced by the form), so
 * it is never lost and always shows under Drafts. Only drafts: a scheduled
 * campaign is saved with the button, which re-checks it can still go out.
 * Doesn't revalidate, so the page the user is typing on isn't re-rendered.
 */
export async function autosaveCampaign(campaignId: string | null, formData: FormData): Promise<AutosaveResult> {
  await requirePermission("edit");
  const existing = campaignId ? await findCampaign(campaignId) : undefined;
  if (campaignId && !existing) return { error: "This campaign no longer exists." };
  if (existing && existing.status !== "draft") return { error: "Only drafts are saved automatically." };
  const saved = await saveCompose(existing, "save", formData, "");
  if (!("savedId" in saved)) return { error: saved.error ?? "Couldn't save." };
  return { ok: true, id: saved.savedId };
}

interface SavedCompose {
  savedId: string;
  testTo: string[];
  schedule: ScheduleChoice | null;
  subject: string;
}

/**
 * Validates the compose form for `intent` and writes the campaign (creating it
 * when there is none yet). Returns an error state instead when anything is off,
 * before writing, so a failed send doesn't leave a half-made campaign behind.
 */
async function saveCompose(
  existing: Campaign | undefined,
  intent: Intent,
  formData: FormData,
  defaultTestTo: string,
): Promise<ActionState | SavedCompose> {
  const parsed = composeSchema.safeParse({
    subject: text(formData, "subject"),
    name: text(formData, "name"),
    previewText: text(formData, "previewText"),
    replyTo: text(formData, "replyTo"),
    format: text(formData, "format") || "html",
    textBody: text(formData, "textBody"),
    source: text(formData, "source"),
    listIds: formData.getAll("listIds").filter((v): v is string => typeof v === "string"),
  });
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { subject, source, previewText, format, textBody } = parsed.data;
  const listIds = await existingListIds(parsed.data.listIds);

  // "current" keeps the campaign's own content (e.g. a design whose template was deleted).
  let content: Partial<Pick<CampaignDoc, "html" | "design" | "templateId">> = {};
  if (!(existing && source === CURRENT_DESIGN)) {
    const resolved = await resolveStartingPoint(source);
    if (!resolved) {
      return { error: "That design is no longer available.", fieldErrors: { source: ["Pick another design."] } };
    }
    content = {
      html: resolved.html,
      design: resolved.design,
      templateId: resolved.templateId,
    };
  }
  const html = content.html ?? existing?.html ?? "";

  // A hand-written text version remembers which HTML it was written for, so
  // the form can warn when the template changes later.
  const textChanged = textBody !== (existing?.textBody ?? "");
  const textBodyFor = !textBody ? null : textChanged ? contentFingerprint(html) : (existing?.textBodyFor ?? null);

  // Validate everything the chosen action needs before writing, so a failed
  // send doesn't leave a half-made campaign behind.
  let testTo: string[] = [];
  if (intent === "test") {
    const addresses = parseTestAddresses(text(formData, "testTo"), defaultTestTo);
    if ("error" in addresses) return { error: addresses.error, fieldErrors: { testTo: [addresses.error] } };
    testTo = addresses.to;
  }

  let schedule: ScheduleChoice | null = null;
  if (intent === "schedule") {
    const check = checkSchedule(text(formData, "when"), text(formData, "timeZone"));
    if (!check.ok) return { error: check.error, fieldErrors: { when: [check.error] } };
    schedule = { at: check.at, local: check.local, timeZone: check.timeZone };
  }

  // Campaign type (A/B test / auto resend / RSS) settings - see src/lib/campaign-types/form.ts.
  const typed = await parseCampaignTypeFields(formData, existing);
  if (!typed.ok) return { error: typed.error, fieldErrors: typed.fieldErrors };

  const settings = await getSettings();
  // A reply-to that only followed the old sender follows Settings again (src/lib/sending/sender.ts).
  const replyTo =
    senderFromSettings({ fromEmail: existing?.fromEmail, replyTo: parsed.data.replyTo }, settings)?.replyTo ??
    (parsed.data.replyTo || settings.replyTo.trim() || null);
  if (intent === "send" || intent === "schedule") {
    const blockers = sendBlockers({
      subject,
      html,
      format,
      textBody,
      fromEmail: settings.fromEmail,
      replyTo,
      listCount: listIds.length,
      recipients: listIds.length ? await countRecipients(listIds) : 0,
    });
    if (blockers.length) {
      const fieldErrors: Record<string, string[]> = {};
      for (const b of blockers) (fieldErrors[b.field] ??= []).push(b.message);
      return { error: describeProblems(blockers.map((b) => b.message)), fieldErrors };
    }
  }

  // --- Save
  const now = new Date();
  const fields = {
    // The internal name defaults to the subject.
    name: parsed.data.name || subject || "Untitled campaign",
    subject,
    previewText: previewText || null,
    listIds,
    // Segments and A/B tests are no longer offered; clear any left over.
    segmentIds: [],
    abTest: null,
    // The sender always comes from Settings; reply-to defaults to Settings.
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo,
    format,
    textBody: textBody || null,
    textBodyFor,
    ...content,
    ...typed.fields,
    // Sending or scheduling an archived draft brings it back (otherwise it would hide in Archived, not the Outbox).
    ...(intent === "send" || intent === "schedule" ? { archivedAt: null } : {}),
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
      templateId: null,
      // Set explicitly: the Drafts tab filters on both.
      parentId: null,
      archivedAt: null,
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
  return { savedId: id, testTo, schedule, subject };
}

async function runIntent(
  id: string,
  intent: Intent,
  opts: { testTo: string[]; schedule: ScheduleChoice | null; wasScheduled: boolean },
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
          format: campaign.format ?? "html",
          textBody: campaign.textBody ?? null,
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

  if (intent === "schedule" && opts.schedule) {
    const result = await campaigns.updateOne(
      { _id: id, status: { $in: EDITABLE_STATUSES }, ...notQueueing() },
      {
        $set: {
          status: "scheduled",
          scheduledAt: opts.schedule.at,
          scheduledLocal: opts.schedule.local,
          scheduledTimeZone: opts.schedule.timeZone,
          updatedAt: new Date(),
        },
      },
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
        { $set: { status: "draft", scheduledAt: null, scheduledLocal: null, scheduledTimeZone: null, updatedAt: new Date() } },
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
  const session = await requirePermission("send");
  const campaign = await findCampaign(campaignId);
  if (!campaign) return NOT_FOUND;

  const { campaigns } = await collections();
  const result = await campaigns.updateOne(
    { _id: campaign.id, status: "scheduled", ...notQueueing() },
    { $set: { status: "draft", scheduledAt: null, scheduledLocal: null, scheduledTimeZone: null, updatedAt: new Date() } },
  );
  if (result.matchedCount === 0) {
    return { error: "This campaign is no longer scheduled - it may have started sending." };
  }
  await audit(session, "campaign.unschedule", { type: "campaign", id: campaign.id, details: { subject: campaign.subject } });

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
  const session = await requirePermission("send");
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
  const auditVerbs: Record<string, string> = { paused: "pause", resumed: "resume", cancelled: "cancel" };
  await audit(session, `campaign.${auditVerbs[verb] ?? verb}`, {
    type: "campaign",
    id: campaign.id,
    details: { subject: campaign.subject },
  });
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

/** A fresh draft with the content, settings and lists of a campaign - no schedule, sends or stats. */
async function copyOf(source: Campaign, now: Date): Promise<CampaignDoc> {
  return {
    _id: newId(),
    name: (source.name === source.subject ? source.name : `${source.name} (copy)`).slice(0, 200),
    subject: source.subject,
    previewText: source.previewText,
    fromName: source.fromName,
    fromEmail: source.fromEmail,
    replyTo: source.replyTo,
    html: source.html,
    design: source.design ?? null,
    templateId: source.templateId,
    format: source.format ?? "html",
    textBody: source.textBody ?? null,
    textBodyFor: source.textBodyFor ?? null,
    folder: source.folder ?? null,
    archivedAt: null,
    listIds: await existingListIds(source.listIds ?? []),
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

export async function duplicateCampaign(campaignId: string): Promise<ActionState> {
  await requirePermission("edit");
  const source = await findCampaign(campaignId);
  if (!source) return NOT_FOUND;
  const copy = await copyOf(source, new Date());
  const { campaigns } = await collections();
  await campaigns.insertOne(copy);

  revalidateCampaigns();
  redirect(`/campaigns/${copy._id}`);
}

// --- Archive / folders (single and bulk) ------------------------------------------

/** Archived campaigns leave the normal tabs; nothing else changes (stats and history stay). */
export async function archiveCampaign(campaignId: string): Promise<ActionState> {
  await requirePermission("edit");
  const id = idSchema.safeParse(campaignId);
  if (!id.success) return NOT_FOUND;
  const { campaigns } = await collections();
  const now = new Date();
  const result = await campaigns.updateOne(
    { _id: id.data, status: { $in: ARCHIVABLE_STATUSES } },
    { $set: { archivedAt: now, updatedAt: now } },
  );
  if (result.matchedCount === 0) return { error: "Only drafts and finished campaigns can be archived." };
  revalidateCampaigns();
  return { ok: true, message: "Archived." };
}

export async function restoreCampaign(campaignId: string): Promise<ActionState> {
  await requirePermission("edit");
  const id = idSchema.safeParse(campaignId);
  if (!id.success) return NOT_FOUND;
  const { campaigns } = await collections();
  const result = await campaigns.updateOne({ _id: id.data }, { $set: { archivedAt: null, updatedAt: new Date() } });
  if (result.matchedCount === 0) return NOT_FOUND;
  revalidateCampaigns();
  return { ok: true, message: "Restored." };
}

/** Put a campaign in a folder (an empty name takes it out of its folder). */
export async function moveCampaign(campaignId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("edit");
  const id = idSchema.safeParse(campaignId);
  if (!id.success) return NOT_FOUND;
  const folder = normalizeFolder(text(formData, "folder"));
  const { campaigns } = await collections();
  const result = await campaigns.updateOne({ _id: id.data }, { $set: { folder: folder || null, updatedAt: new Date() } });
  if (result.matchedCount === 0) return NOT_FOUND;
  revalidateCampaigns();
  return { ok: true, message: folder ? `Moved to ${folder}.` : "Removed from its folder." };
}

const MAX_BULK = 100;
const bulkSchema = z.object({
  intent: z.enum(["duplicate", "archive", "restore", "move"]),
  ids: z.array(idSchema).min(1, "Select at least one campaign.").max(MAX_BULK, `Select at most ${MAX_BULK} campaigns.`),
  folder: z.string().max(200),
});

/** Bulk actions for the campaigns selected on the list page. */
export async function bulkCampaigns(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("edit");
  const parsed = bulkSchema.safeParse({
    intent: text(formData, "intent"),
    ids: [...new Set(formData.getAll("ids").filter((v): v is string => typeof v === "string"))],
    folder: text(formData, "folder"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Select at least one campaign." };
  const { intent, ids } = parsed.data;
  const { campaigns } = await collections();
  const now = new Date();
  const plural = (n: number) => `${formatNumber(n)} ${n === 1 ? "campaign" : "campaigns"}`;

  if (intent === "duplicate") {
    const sources = (await campaigns.find({ _id: { $in: ids } }).toArray()).map(fromDoc);
    if (sources.length === 0) return { error: "Those campaigns no longer exist." };
    const copies = await Promise.all(sources.map((source) => copyOf(source, now)));
    await campaigns.insertMany(copies);
    revalidateCampaigns();
    return { ok: true, message: `Duplicated ${plural(copies.length)}. The copies are in Drafts.` };
  }
  if (intent === "archive") {
    const result = await campaigns.updateMany(
      { _id: { $in: ids }, status: { $in: ARCHIVABLE_STATUSES } },
      { $set: { archivedAt: now, updatedAt: now } },
    );
    revalidateCampaigns();
    const skipped = ids.length - result.matchedCount;
    return {
      ok: true,
      message: `Archived ${plural(result.matchedCount)}.${skipped ? ` ${plural(skipped)} in the outbox ${skipped === 1 ? "was" : "were"} skipped.` : ""}`,
    };
  }
  if (intent === "restore") {
    const result = await campaigns.updateMany({ _id: { $in: ids } }, { $set: { archivedAt: null, updatedAt: now } });
    revalidateCampaigns();
    return { ok: true, message: `Restored ${plural(result.matchedCount)}.` };
  }
  const folder = normalizeFolder(parsed.data.folder);
  const result = await campaigns.updateMany({ _id: { $in: ids } }, { $set: { folder: folder || null, updatedAt: now } });
  revalidateCampaigns();
  return {
    ok: true,
    message: folder ? `Moved ${plural(result.matchedCount)} to ${folder}.` : `Removed ${plural(result.matchedCount)} from their folder.`,
  };
}

export async function deleteCampaign(campaignId: string): Promise<ActionState> {
  const session = await requirePermission("delete");
  const campaign = await findCampaign(campaignId);
  if (!campaign) return NOT_FOUND;
  // Drafts and finished campaigns can go; anything scheduled or sending must be stopped first.
  const deletable: CampaignStatus[] = ["draft", "sent", "cancelled"];
  if (!deletable.includes(campaign.status)) {
    return { error: "Stop or unschedule this campaign before deleting it." };
  }

  const { campaigns, sends, clicks, opens } = await collections();
  const result = await campaigns.deleteOne({ _id: campaign.id, status: { $in: deletable }, ...notQueueing() });
  if (result.deletedCount === 0) return { error: "This campaign can't be deleted right now." };
  // Its sends and clicks (the stats) go with it. Contacts, and their unsubscribes, are untouched.
  await Promise.all([
    sends.deleteMany({ campaignId: campaign.id }),
    clicks.deleteMany({ campaignId: campaign.id }),
    opens.deleteMany({ campaignId: campaign.id }),
  ]);
  await audit(session, "campaign.delete", { type: "campaign", id: campaign.id, details: { subject: campaign.subject, status: campaign.status } });

  revalidateCampaigns();
  redirect("/campaigns");
}
