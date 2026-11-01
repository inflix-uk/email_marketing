// Auto resend - the pure rules, unit-tested.
//
// Who gets the second email: people the first email was sent to, who didn't
// open (or didn't click) it, and who can still be emailed (still subscribed:
// not unsubscribed, bounced or complained since).
// A click proves an open even when the open pixel was blocked, so "didn't
// open" also leaves out anyone who clicked.

import type { Filter } from "mongodb";
import type { ContactStatus, ResendSettings, SendDoc } from "@/db/schema";

export type ResendCondition = ResendSettings["condition"];

export const MIN_RESEND_HOURS = 1;
export const MAX_RESEND_HOURS = 30 * 24;

type SendFacts = Pick<SendDoc, "status" | "openedAt" | "clickedAt" | "unsubscribedAt"> &
  Partial<Pick<SendDoc, "bouncedAt" | "complainedAt">>;

export function isResendEligible(send: SendFacts, contactStatus: ContactStatus | null | undefined, condition: ResendCondition): boolean {
  if (send.status !== "sent") return false;
  if (send.unsubscribedAt || send.bouncedAt || send.complainedAt) return false;
  if (contactStatus !== "subscribed") return false;
  if (send.clickedAt) return false;
  if (condition === "not_opened" && send.openedAt) return false;
  return true;
}

/** The same rule as a query over the first email's sends (the contact status is checked separately). */
export function resendSendFilter(parentId: string, condition: ResendCondition): Filter<SendDoc> {
  return {
    campaignId: parentId,
    status: "sent",
    unsubscribedAt: null,
    bouncedAt: null,
    complainedAt: null,
    clickedAt: null,
    ...(condition === "not_opened" ? { openedAt: null } : {}),
  };
}

export function clampResendHours(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 72;
  return Math.min(MAX_RESEND_HOURS, Math.max(MIN_RESEND_HOURS, Math.round(n)));
}

/** When the resend is due: delay after the first email started sending. */
export function resendDueAt(startedAt: Date, delayHours: number): Date {
  return new Date(startedAt.getTime() + clampResendHours(delayHours) * 3_600_000);
}

/** "3 days" / "12 hours" */
export function describeDelay(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
