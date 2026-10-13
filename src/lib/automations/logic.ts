// Pure automation rules: delay maths, trigger matching, step advancing and
// activation checks. No database access - unit-tested in logic.test.ts and
// shared by the engine (enroll.ts / process.ts) and the automation pages.

import type { AutomationDoc, AutomationStep, AutomationTrigger } from "@/db/schema";
import { isValidEmail } from "@/lib/utils";

/** The event shape of the public contract (see ./index.ts). */
export type AutomationEvent =
  | { type: "list_joined"; listId: string; contactIds: string[] }
  | { type: "form_submitted"; formId: string; contactIds: string[] }
  | { type: "tag_added"; tag: string; contactIds: string[] };

// ---------------------------------------------------------------------------
// Delays
// ---------------------------------------------------------------------------

export const DELAY_UNITS = ["minutes", "hours", "days"] as const;
export type DelayUnit = (typeof DELAY_UNITS)[number];

const UNIT_MINUTES: Record<DelayUnit, number> = { minutes: 1, hours: 60, days: 24 * 60 };

/** Longest wait between two emails: one year. */
export const MAX_DELAY_MINUTES = 365 * 24 * 60;
export const MAX_STEPS = 20;

/** (2, "days") -> 2880. Negative / non-numeric input counts as 0; capped at MAX_DELAY_MINUTES. */
export function delayToMinutes(value: number, unit: DelayUnit): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_DELAY_MINUTES, Math.round(value * UNIT_MINUTES[unit]));
}

/** 2880 -> { value: 2, unit: "days" }: the largest unit that divides the delay exactly. */
export function splitDelay(minutes: number): { value: number; unit: DelayUnit } {
  const m = sanitizeDelay(minutes);
  if (m > 0 && m % UNIT_MINUTES.days === 0) return { value: m / UNIT_MINUTES.days, unit: "days" };
  if (m > 0 && m % UNIT_MINUTES.hours === 0) return { value: m / UNIT_MINUTES.hours, unit: "hours" };
  return { value: m, unit: "minutes" };
}

/** "immediately", "1 minute", "3 hours", "2 days". */
export function formatDelay(minutes: number): string {
  const { value, unit } = splitDelay(minutes);
  if (value === 0) return "immediately";
  return `${value} ${value === 1 ? unit.slice(0, -1) : unit}`;
}

/** "Immediately after the trigger" / "2 days after the previous email". */
export function describeStepTiming(delayMinutes: number, index: number): string {
  const after = index === 0 ? "the trigger" : "the previous email";
  const delay = formatDelay(delayMinutes);
  return delay === "immediately" ? `Immediately after ${after}` : `${delay} after ${after}`;
}

function sanitizeDelay(minutes: unknown): number {
  const n = Number(minutes);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_DELAY_MINUTES, n) : 0;
}

/** When a step with this delay runs, counted from `from`. */
export function runAtAfter(from: Date, delayMinutes: number): Date {
  return new Date(from.getTime() + sanitizeDelay(delayMinutes) * 60_000);
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/** Tags are stored lower-cased and trimmed. */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/** Does an automation with this trigger start for this event? */
export function matchesTrigger(trigger: AutomationTrigger | null | undefined, event: AutomationEvent): boolean {
  if (!trigger || trigger.type !== event.type) return false;
  switch (event.type) {
    case "list_joined":
      return trigger.type === "list_joined" && !!event.listId && trigger.listId === event.listId;
    case "form_submitted":
      return trigger.type === "form_submitted" && !!event.formId && trigger.formId === event.formId;
    case "tag_added":
      return (
        trigger.type === "tag_added" && !!normalizeTag(event.tag) && normalizeTag(trigger.tag) === normalizeTag(event.tag)
      );
    default:
      return false;
  }
}

/**
 * MongoDB filter on `trigger.*` selecting the automations an event can start
 * (a pre-filter: matchesTrigger() stays the source of truth). null = the event
 * can't match anything.
 */
export function triggerFilter(event: AutomationEvent): Record<string, string> | null {
  switch (event.type) {
    case "list_joined":
      return event.listId ? { "trigger.type": "list_joined", "trigger.listId": event.listId } : null;
    case "form_submitted":
      return event.formId ? { "trigger.type": "form_submitted", "trigger.formId": event.formId } : null;
    case "tag_added": {
      const tag = normalizeTag(event.tag ?? "");
      return tag ? { "trigger.type": "tag_added", "trigger.tag": tag } : null;
    }
    default:
      return null;
  }
}

/** Plain-English trigger, e.g. "Joins list Newsletter". Unknown ids read as deleted. */
export function describeTrigger(
  trigger: AutomationTrigger,
  names: { lists?: ReadonlyMap<string, string>; forms?: ReadonlyMap<string, string> } = {},
): string {
  switch (trigger.type) {
    case "list_joined":
      return `Joins list ${quote(names.lists?.get(trigger.listId)) ?? "(deleted list)"}`;
    case "form_submitted":
      return `Submits form ${quote(names.forms?.get(trigger.formId)) ?? "(deleted form)"}`;
    case "tag_added":
      return `Gets tag ${quote(trigger.tag) ?? "(no tag)"}`;
    default:
      return "Unknown trigger";
  }
}

function quote(value: string | undefined): string | null {
  return value ? `"${value}"` : null;
}

// ---------------------------------------------------------------------------
// Enrolment + advancing
// ---------------------------------------------------------------------------

type StepTiming = Pick<AutomationStep, "delayMinutes">;

/** First run of a new enrolment: the trigger time plus the first step's delay. null = no steps. */
export function firstRunAt(steps: readonly StepTiming[], now: Date): Date | null {
  return steps.length > 0 ? runAtAfter(now, steps[0].delayMinutes) : null;
}

export type Advance =
  | { status: "completed"; stepIndex: number }
  | { status: "active"; stepIndex: number; nextRunAt: Date };

/**
 * Where an enrolment goes once the step at `stepIndex` is dealt with (sent,
 * permanently failed, or found already sent): the next step, due after its own
 * delay counted from now, or "completed" after the last one.
 */
export function advanceAfterStep(steps: readonly StepTiming[], stepIndex: number, now: Date): Advance {
  const next = Math.max(0, Math.floor(stepIndex)) + 1;
  if (next >= steps.length) return { status: "completed", stepIndex: next };
  return { status: "active", stepIndex: next, nextRunAt: runAtAfter(now, steps[next].delayMinutes) };
}

/** Total delivery attempts per step for temporary (4xx / network) errors. */
export const MAX_STEP_ATTEMPTS = 3;
/** Wait before attempt 2 and attempt 3. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];

/** How long to wait before trying again after `attempts` failed attempts. */
export function retryDelayMs(attempts: number): number {
  const i = Math.min(Math.max(1, Math.floor(attempts)), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[i];
}

export type FailureAction = "retry" | "fail";

/** Permanent errors and the last allowed attempt fail the step; anything else is retried later. */
export function failureAction(opts: { permanent: boolean; attempts: number }): FailureAction {
  return opts.permanent || opts.attempts >= MAX_STEP_ATTEMPTS ? "fail" : "retry";
}

// ---------------------------------------------------------------------------
// Activation checks
// ---------------------------------------------------------------------------

type Activatable = Pick<AutomationDoc, "trigger" | "steps" | "fromName" | "fromEmail">;

/** True when the HTML has something a reader would see (text, an image or a link). */
export function hasContent(html: string | null | undefined): boolean {
  if (!html) return false;
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1>/gi, "");
  if (/<(img|a)\b/i.test(body)) return true;
  return body.replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;|&zwnj;/gi, " ").trim().length > 0;
}

/** Everything that stops an automation from being switched on, as short instructions. Empty = ready. */
export function getActivationProblems(automation: Activatable): string[] {
  const problems: string[] = [];

  const trigger = automation.trigger;
  if (!trigger) problems.push("Choose what starts this automation.");
  else if (trigger.type === "list_joined" && !trigger.listId) problems.push("Choose the list that starts this automation.");
  else if (trigger.type === "form_submitted" && !trigger.formId) problems.push("Choose the form that starts this automation.");
  else if (trigger.type === "tag_added" && !normalizeTag(trigger.tag ?? "")) problems.push("Enter the tag that starts this automation.");

  if (!automation.fromName?.trim()) problems.push("Add a from name.");
  if (!automation.fromEmail?.trim()) problems.push("Add a from email.");
  else if (!isValidEmail(automation.fromEmail)) problems.push("The from email isn't a valid address.");

  const steps = automation.steps ?? [];
  if (steps.length === 0) problems.push("Add at least one email.");
  if (steps.length > MAX_STEPS) problems.push(`Use at most ${MAX_STEPS} emails.`);
  steps.forEach((step, i) => {
    const label = `Email ${i + 1}`;
    if (!step.subject?.trim()) problems.push(`${label} needs a subject line.`);
    if (!hasContent(step.html)) problems.push(`${label} has no content.`);
    if (!Number.isFinite(step.delayMinutes) || step.delayMinutes < 0) problems.push(`${label} has an invalid delay.`);
  });
  return problems;
}
