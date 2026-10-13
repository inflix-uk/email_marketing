import type { ContactStatus } from "@/db/schema";

// Pure rules for what a sign-up form submission and a confirmation click may
// do to a contact. No database access here (unit-tested in decision.test.ts).

export type SignupDecision =
  /** Unknown address: create the contact (and email a confirmation link when pending). */
  | { action: "create"; status: "pending" | "subscribed" }
  /** Already subscribed: just add the form's lists and tags. */
  | { action: "add_lists" }
  /** Waiting for a confirmation from another form, this form has no double opt-in: subscribe now. */
  | { action: "subscribe" }
  /** Email a confirmation link; nothing changes until it is clicked. */
  | { action: "send_confirmation" }
  /** Leave the contact exactly as it is. */
  | { action: "ignore" };

/** Contacts created from the suppression list carry this source: they must never be emailed again. */
export const SUPPRESSION_SOURCE = "suppression";

/** The parts of a contact the rules look at. */
export interface ContactState {
  status: ContactStatus;
  source?: string | null;
}

/**
 * What a submission does, from the existing contact (null = unknown address)
 * and the form's double opt-in setting.
 *
 * An unsubscribed contact only comes back by clicking a fresh confirmation
 * link (an explicit new opt-in). Bounced / complained contacts and addresses
 * on the suppression list never change.
 */
export function decideSignup(contact: ContactState | null, doubleOptIn: boolean): SignupDecision {
  if (!contact) return { action: "create", status: doubleOptIn ? "pending" : "subscribed" };
  if (contact.source === SUPPRESSION_SOURCE) return { action: "ignore" };
  switch (contact.status) {
    case "subscribed":
      return { action: "add_lists" };
    case "pending":
      return doubleOptIn ? { action: "send_confirmation" } : { action: "subscribe" };
    case "unsubscribed":
      return doubleOptIn ? { action: "send_confirmation" } : { action: "ignore" };
    case "bounced":
    case "complained":
      return { action: "ignore" };
  }
}

/** Confirmation links stop working after this long. */
export const CONFIRM_LINK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type ConfirmDecision = "subscribe" | "already" | "expired" | "refused";

/**
 * What clicking a confirmation link does.
 * - pending -> subscribe.
 * - unsubscribed -> subscribe, but only when the link was requested AFTER they
 *   unsubscribed (so an old link in an old email can't undo a later unsubscribe).
 * - subscribed -> nothing to do (second click).
 * - bounced / complained / on the suppression list -> never changed.
 */
export function decideConfirmation(input: {
  status: ContactStatus;
  source?: string | null;
  unsubscribedAt: Date | null;
  /** When the link was created. */
  issuedAt: Date;
  now: Date;
}): ConfirmDecision {
  const { status, source, unsubscribedAt, issuedAt, now } = input;
  if (source === SUPPRESSION_SOURCE) return "refused";
  if (status === "subscribed") return "already";
  if (status === "bounced" || status === "complained") return "refused";
  const age = now.getTime() - issuedAt.getTime();
  if (age > CONFIRM_LINK_MAX_AGE_MS || age < -60_000) return "expired";
  if (status === "unsubscribed" && unsubscribedAt && issuedAt.getTime() <= unsubscribedAt.getTime()) return "expired";
  return "subscribe";
}
