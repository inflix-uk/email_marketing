"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { collections } from "@/db";
import {
  automationSendKey,
  newId,
  type AutomationDoc,
  type AutomationStep,
  type AutomationTrigger,
} from "@/db/schema";
import { requireSession } from "@/lib/auth";
import {
  DELAY_UNITS,
  MAX_DELAY_MINUTES,
  MAX_STEPS,
  delayToMinutes,
  getActivationProblems,
  normalizeTag,
} from "@/lib/automations";
import { parseDesign, renderDesign, serializeDesign } from "@/lib/email-design";
import { isValidEmail, normalizeEmail } from "@/lib/utils";

// Automation actions are bound to an automation id in the page
// (`pauseAutomation.bind(null, id)`) and driven by useActionState. Those that
// need no form input simply omit the (prevState, formData) parameters.

export interface ActionState {
  ok?: boolean;
  message?: string;
  /** Shown instead of `message` when the action worked but needs attention. */
  warning?: string;
  error?: string;
  /** Keys are field names; step fields are suffixed with the step id, e.g. `subject-<stepId>`. */
  fieldErrors?: Record<string, string[] | undefined>;
  savedAt?: number;
}

// --- Helpers ------------------------------------------------------------------

const idSchema = z.string().trim().min(1).max(64);
/** Step ids end up inside automationSendKey(...): letters, digits and dashes only. */
const STEP_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** A MongoDB document holds 16 MB at most; keep all emails of one automation well below that. */
const MAX_TOTAL_CONTENT = 10_000_000;

const NOT_FOUND: ActionState = { error: "This automation no longer exists." };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function revalidateAutomations() {
  revalidatePath("/automations", "layout");
}

/** ["Add a from name.", "Email 2 needs a subject line."] -> "Add a from name; Email 2 needs a subject line." */
function describeProblems(problems: string[]): string {
  return `${problems.map((p) => p.trim().replace(/\.+$/, "")).join("; ")}.`;
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

// --- Save (create + edit) -------------------------------------------------------

const detailsSchema = z.object({
  name: z.string().trim().min(1, "Give your automation a name.").max(200, "Keep the name under 200 characters."),
  fromName: headerText(100, "The from name"),
  fromEmail: optionalEmail,
  replyTo: optionalEmail,
});

const triggerSchema = z.object({
  triggerType: z.enum(["list_joined", "form_submitted", "tag_added"], { error: "Choose what starts this automation." }),
  listId: z.string().trim().max(64),
  formId: z.string().trim().max(64),
  tag: z
    .string()
    .max(200)
    .transform((v) => normalizeTag(v))
    .refine((v) => v.length <= 50, "Keep the tag under 50 characters."),
});

const stepSchema = z.object({
  delayValue: z.string().trim().regex(/^\d{1,5}$/, "Enter a whole number, 0 or more."),
  delayUnit: z.enum(DELAY_UNITS, { error: "Choose minutes, hours or days." }),
  subject: headerText(300, "The subject"),
  previewText: headerText(300, "Preview text"),
  html: z.string().max(1_000_000, "This email is too large (over 1 MB of HTML).").optional(),
  design: z.string().max(2_000_000, "This email's design is too large.").optional(),
});

/** Field name of a step's form control / error, e.g. stepField("subject", id) -> "subject-<id>". */
function stepField(name: string, stepId: string): string {
  return `${name}-${stepId}`;
}

/**
 * Create (automationId = null) or update an automation from the editor form.
 * `intent=activate` also switches it on when everything needed is there.
 */
export async function saveAutomation(
  automationId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSession();

  const { automations, lists, forms } = await collections();
  let current: Pick<AutomationDoc, "_id" | "status" | "steps"> | null = null;
  if (automationId !== null) {
    const id = idSchema.safeParse(automationId);
    if (!id.success) return NOT_FOUND;
    current = await automations.findOne({ _id: id.data }, { projection: { status: 1, steps: 1 } });
    if (!current) return NOT_FOUND;
  }

  const fieldErrors: Record<string, string[] | undefined> = {};

  // Details and sender.
  const details = detailsSchema.safeParse({
    name: text(formData, "name"),
    fromName: text(formData, "fromName"),
    fromEmail: text(formData, "fromEmail"),
    replyTo: text(formData, "replyTo"),
  });
  if (!details.success) Object.assign(fieldErrors, z.flattenError(details.error).fieldErrors);

  // Trigger: the chosen list / form must still exist.
  const triggerInput = triggerSchema.safeParse({
    triggerType: text(formData, "triggerType"),
    listId: text(formData, "listId"),
    formId: text(formData, "formId"),
    tag: text(formData, "tag"),
  });
  let trigger: AutomationTrigger | null = null;
  if (!triggerInput.success) {
    Object.assign(fieldErrors, z.flattenError(triggerInput.error).fieldErrors);
  } else {
    const d = triggerInput.data;
    if (d.triggerType === "list_joined") {
      if (!d.listId) fieldErrors.listId = ["Choose a list."];
      else if ((await lists.countDocuments({ _id: d.listId }, { limit: 1 })) === 0) {
        fieldErrors.listId = ["That list no longer exists. Choose another one."];
      } else trigger = { type: "list_joined", listId: d.listId };
    } else if (d.triggerType === "form_submitted") {
      if (!d.formId) fieldErrors.formId = ["Choose a form."];
      else if ((await forms.countDocuments({ _id: d.formId }, { limit: 1 })) === 0) {
        fieldErrors.formId = ["That form no longer exists. Choose another one."];
      } else trigger = { type: "form_submitted", formId: d.formId };
    } else if (!d.tag) {
      fieldErrors.tag = ["Enter a tag."];
    } else {
      trigger = { type: "tag_added", tag: d.tag };
    }
  }

  // Steps, in the order they appear in the form.
  const stepIds = formData.getAll("stepIds").filter((v): v is string => typeof v === "string");
  if (stepIds.length > MAX_STEPS) return { error: `An automation can have at most ${MAX_STEPS} emails.` };
  if (stepIds.some((id) => !STEP_ID_RE.test(id)) || new Set(stepIds).size !== stepIds.length) {
    return { error: "The emails in this form are out of sync. Reload the page and try again." };
  }

  const previous = new Map((current?.steps ?? []).map((s) => [s.id, s]));
  const steps: AutomationStep[] = [];
  let contentSize = 0;
  for (const id of stepIds) {
    const parsed = stepSchema.safeParse({
      delayValue: text(formData, stepField("delayValue", id)),
      delayUnit: text(formData, stepField("delayUnit", id)),
      subject: text(formData, stepField("subject", id)),
      previewText: text(formData, stepField("previewText", id)),
      // A missing field means "leave it alone" rather than "wipe it".
      html: formData.has(stepField("html", id)) ? text(formData, stepField("html", id)) : undefined,
      design: formData.has(stepField("design", id)) ? text(formData, stepField("design", id)) : undefined,
    });
    if (!parsed.success) {
      const errors = z.flattenError(parsed.error).fieldErrors;
      const delay = errors.delayValue ?? errors.delayUnit;
      if (delay) fieldErrors[stepField("delay", id)] = delay;
      if (errors.subject) fieldErrors[stepField("subject", id)] = errors.subject;
      if (errors.previewText) fieldErrors[stepField("previewText", id)] = errors.previewText;
      const content = errors.html ?? errors.design;
      if (content) fieldErrors[stepField("html", id)] = content;
      continue;
    }
    const s = parsed.data;
    const rawMinutes = Number(s.delayValue) * { minutes: 1, hours: 60, days: 1440 }[s.delayUnit];
    if (rawMinutes > MAX_DELAY_MINUTES) {
      fieldErrors[stepField("delay", id)] = ["The longest wait between two emails is 365 days."];
      continue;
    }
    const before = previous.get(id);
    let html = s.html ?? before?.html ?? "";
    let design = s.design !== undefined ? s.design.trim() || null : (before?.design ?? null);
    if (s.design !== undefined && design) {
      // Visual mode: the design is the source of truth. Store it in canonical
      // form and generate the HTML from it, so the two can never disagree.
      const parsedDesign = parseDesign(design);
      if (!parsedDesign) {
        fieldErrors[stepField("html", id)] = ["This email's visual design couldn't be read. Reload the page and try again."];
        continue;
      }
      design = serializeDesign(parsedDesign);
      html = renderDesign(parsedDesign);
    }
    contentSize += html.length + (design?.length ?? 0);
    steps.push({
      id,
      delayMinutes: delayToMinutes(Number(s.delayValue), s.delayUnit),
      subject: s.subject,
      previewText: s.previewText || null,
      html,
      design,
    });
  }

  if (!details.success || !trigger || Object.keys(fieldErrors).length > 0) {
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }
  if (contentSize > MAX_TOTAL_CONTENT) {
    return { error: "These emails are too large to save together. Remove large embedded images or split the series." };
  }

  const data = details.data;
  const content = {
    name: data.name,
    trigger,
    steps,
    fromName: data.fromName,
    fromEmail: data.fromEmail,
    replyTo: data.replyTo || null,
  };
  const now = new Date();

  // Create: always a draft; it is switched on from its own page.
  if (!current) {
    const created: AutomationDoc = { _id: newId(), status: "draft", ...content, createdAt: now, updatedAt: now };
    await automations.insertOne(created);
    revalidateAutomations();
    redirect(`/automations/${created._id}`);
  }

  // A live automation is sending right now: never save it into a state that can't send.
  const problems = getActivationProblems(content);
  if (current.status === "active" && problems.length > 0) {
    return {
      error: `This automation is active, so it has to stay ready to send: ${describeProblems(problems)} Pause it first to save unfinished changes.`,
    };
  }

  // Conditional on the status we validated against (it may be activated / paused in another tab).
  const saved = await automations.updateOne({ _id: current._id, status: current.status }, { $set: { ...content, updatedAt: now } });
  if (saved.matchedCount === 0) {
    return { error: "This automation was changed somewhere else just now. Reload the page and try again." };
  }
  revalidateAutomations();

  if (text(formData, "intent") !== "activate" || current.status === "active") {
    return { ok: true, savedAt: Date.now(), message: "Changes saved." };
  }
  if (problems.length > 0) {
    return { ok: true, savedAt: Date.now(), warning: `Saved, but not switched on yet: ${describeProblems(problems)}` };
  }
  // Only the exact version that was just saved and checked is activated.
  const activated = await automations.updateOne(
    { _id: current._id, status: { $in: ["draft", "paused"] }, updatedAt: now },
    { $set: { status: "active", updatedAt: new Date() } },
  );
  if (activated.matchedCount === 0) {
    return { ok: true, savedAt: Date.now(), warning: "Saved, but the automation changed while it was being switched on. Reload the page and try again." };
  }
  revalidateAutomations();
  return {
    ok: true,
    savedAt: Date.now(),
    message: current.status === "paused" ? "Saved. The automation is running again." : "Saved. The automation is now active.",
  };
}

// --- Pause / delete -------------------------------------------------------------

/** Stop sending. People already in the series keep their place and continue when it is resumed. */
export async function pauseAutomation(automationId: string): Promise<ActionState> {
  await requireSession();
  const id = idSchema.safeParse(automationId);
  if (!id.success) return NOT_FOUND;

  const { automations } = await collections();
  const result = await automations.updateOne(
    { _id: id.data, status: "active" },
    { $set: { status: "paused", updatedAt: new Date() } },
  );
  if (result.matchedCount === 0) {
    const exists = await automations.countDocuments({ _id: id.data }, { limit: 1 });
    return exists ? { error: "This automation isn't active, so there is nothing to pause." } : NOT_FOUND;
  }
  revalidateAutomations();
  return { ok: true, message: "Automation paused." };
}

/** Delete an automation and everyone's place in it. Emails already sent keep their unsubscribe links and stats. */
export async function deleteAutomation(automationId: string): Promise<ActionState> {
  await requireSession();
  const id = idSchema.safeParse(automationId);
  if (!id.success) return NOT_FOUND;

  const { automations, enrollments, sends } = await collections();
  // Automation first: once it is gone the worker stops picking its enrolments.
  const deleted = await automations.findOneAndDelete({ _id: id.data }, { projection: { "steps.id": 1 } });
  await enrollments.deleteMany({ automationId: id.data });
  // Emails still waiting for a retry will never go out. Sent ones are kept as they are.
  const keys = (deleted?.steps ?? []).map((s) => automationSendKey(id.data, s.id));
  if (keys.length > 0) {
    await sends.updateMany(
      { campaignId: { $in: keys }, status: { $in: ["queued", "sending"] } },
      { $set: { status: "skipped", lastError: "Automation deleted", updatedAt: new Date() } },
    );
  }

  revalidateAutomations();
  redirect("/automations");
}
