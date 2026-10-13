import type { Filter } from "mongodb";
import { collections, isDuplicateKeyError } from "@/db";
import { newId, type ContactConsent, type ContactDoc, type Form } from "@/db/schema";
import { triggerAutomations } from "@/lib/automations";
import { existingListIds } from "@/lib/contacts/queries";
import { sendEmail } from "@/lib/mailer";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings, isDevMailer } from "@/lib/settings";
import { getLinkContext } from "@/lib/tokens";
import { isValidEmail } from "@/lib/utils";
import { buildConfirmationEmail } from "./confirmation-email";
import { decideConfirmation, decideSignup, SUPPRESSION_SOURCE } from "./decision";
import { getForm } from "./store";
import { buildConfirmUrl, verifyConfirmToken } from "./tokens";
import type { Submission } from "./validation";

// What happens when someone submits a sign-up form or clicks a confirmation
// link. The rules live in decision.ts; this file applies them with atomic
// single-document updates (status conditions as claims, no transactions).
//
// Both entry points return a `followUp` to run after the response was sent
// (confirmation email, automations), so every submission answers equally fast
// whether the address was known or not.

/** Confirmation emails per address per hour (a form can't be used to flood an inbox). */
const CONFIRMATION_LIMIT = { limit: 3, windowSeconds: 60 * 60 };

type FollowUp = () => Promise<void>;
type FormTarget = Pick<Form, "id" | "listIds" | "tags">;

const noFollowUp: FollowUp = async () => {};

function consentSource(formId: string): string {
  return `form:${formId}`;
}

/** Run after a contact became (or already was) subscribed through a form. Never throws. */
function automationsFollowUp(formId: string, contactId: string, joinedListIds: string[], addedTags: string[]): FollowUp {
  return async () => {
    const contactIds = [contactId];
    await triggerAutomations({ type: "form_submitted", formId, contactIds });
    for (const listId of joinedListIds) await triggerAutomations({ type: "list_joined", listId, contactIds });
    for (const tag of addedTags) await triggerAutomations({ type: "tag_added", tag, contactIds });
  };
}

function confirmationFollowUp(contact: Pick<ContactDoc, "_id" | "email" | "firstName">, formId: string): FollowUp {
  return async () => {
    try {
      await sendConfirmationEmail(contact, formId);
    } catch (err) {
      console.error("[forms] could not send the confirmation email", err);
    }
  };
}

/** Email the "Confirm subscription" link (rate limited per address). Returns false when skipped. */
export async function sendConfirmationEmail(
  contact: Pick<ContactDoc, "_id" | "email" | "firstName">,
  formId: string,
): Promise<boolean> {
  const allowed = await rateLimit(`confirm-email:${contact.email}`, CONFIRMATION_LIMIT);
  if (!allowed.ok) return false;

  const [settings, links] = await Promise.all([getSettings(), getLinkContext()]);
  if (!isDevMailer(settings) && !isValidEmail(settings.fromEmail)) {
    console.error("[forms] confirmation email not sent: set a sender email address on the Settings page");
    return false;
  }
  await sendEmail(
    buildConfirmationEmail({
      to: contact.email,
      firstName: contact.firstName,
      confirmUrl: buildConfirmUrl(links, contact._id, formId),
      fromName: settings.fromName,
      fromEmail: settings.fromEmail,
      replyTo: settings.replyTo,
      companyAddress: settings.companyAddress,
    }),
  );
  return true;
}

const difference = (values: string[], without: readonly string[] | undefined) =>
  values.filter((v) => !(without ?? []).includes(v));
const union = (a: readonly string[] | undefined, b: string[]) => [...new Set([...(a ?? []), ...b])];

/**
 * Move a contact to "subscribed" with ONE conditional update, adding the
 * form's lists and tags. The filter repeats the rules of decision.ts, so the
 * change only happens if they still hold at the moment of the write:
 * - never a contact from the suppression list;
 * - "pending" always; "unsubscribed" only when `issuedAt` is given (a
 *   confirmation link) and the contact unsubscribed before that moment.
 * Returns the automations to trigger, or null when nothing was changed.
 */
async function subscribeExisting(
  contact: Pick<ContactDoc, "_id" | "status">,
  form: FormTarget,
  consent: ContactConsent,
  now: Date,
  issuedAt: Date | null,
): Promise<FollowUp | null> {
  const { contacts } = await collections();
  const allowed: Filter<ContactDoc>[] = [{ status: "pending" }];
  if (issuedAt) {
    allowed.push({ status: "unsubscribed", $or: [{ unsubscribedAt: null }, { unsubscribedAt: { $lt: issuedAt } }] });
  }
  const before = await contacts.findOneAndUpdate(
    // `status: contact.status` keeps the consent we computed in step with what we read.
    { _id: contact._id, status: contact.status, source: { $ne: SUPPRESSION_SOURCE }, $or: allowed },
    {
      $set: { status: "subscribed", unsubscribedAt: null, consent, updatedAt: now },
      $addToSet: { listIds: { $each: form.listIds }, tags: { $each: form.tags } },
    },
    { returnDocument: "before" },
  );
  if (!before) return null;
  // A pending contact wasn't really on its lists yet, so confirming joins all of them.
  const wasPending = before.status === "pending";
  const joined = wasPending ? union(before.listIds, form.listIds) : difference(form.listIds, before.listIds);
  const tagged = wasPending ? union(before.tags, form.tags) : difference(form.tags, before.tags);
  return automationsFollowUp(form.id, contact._id, joined, tagged);
}

// --- Form submission ----------------------------------------------------------------

export interface SignupInput {
  form: Form;
  submission: Submission;
  ip: string | null;
}

/**
 * Apply one valid submission. The caller answers the same way whatever
 * happened here, so the response never reveals whether the address was known.
 */
export async function handleSignup({ form, submission, ip }: SignupInput): Promise<{ followUp: FollowUp }> {
  const { contacts, forms } = await collections();
  const now = new Date();
  const target: FormTarget = { id: form.id, listIds: await existingListIds(form.listIds), tags: form.tags };
  const consent: ContactConsent = { source: consentSource(form.id), ip, at: now, confirmedAt: null };

  await forms.updateOne({ _id: form.id }, { $inc: { submissions: 1 } });

  let existing = await contacts.findOne({ email: submission.email });
  let decision = decideSignup(existing, form.doubleOptIn);

  if (decision.action === "create") {
    const doc: ContactDoc = {
      _id: newId(),
      email: submission.email,
      firstName: submission.firstName,
      lastName: submission.lastName,
      fields: submission.fields,
      status: decision.status,
      source: "form",
      listIds: target.listIds,
      tags: target.tags,
      consent,
      unsubscribedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await contacts.insertOne(doc);
      return {
        followUp:
          doc.status === "pending"
            ? confirmationFollowUp(doc, form.id)
            : automationsFollowUp(form.id, doc._id, target.listIds, target.tags),
      };
    } catch (err) {
      // Lost a race on the unique email index: treat it as the existing contact it now is.
      existing = isDuplicateKeyError(err) ? await contacts.findOne({ email: submission.email }) : null;
      if (!existing) throw err;
      decision = decideSignup(existing, form.doubleOptIn);
    }
  }
  if (!existing) return { followUp: noFollowUp };

  switch (decision.action) {
    case "add_lists": {
      const before = await contacts.findOneAndUpdate(
        { _id: existing._id, status: "subscribed", source: { $ne: SUPPRESSION_SOURCE } },
        { $addToSet: { listIds: { $each: target.listIds }, tags: { $each: target.tags } }, $set: { updatedAt: now } },
        { returnDocument: "before" },
      );
      if (!before) break;
      return {
        followUp: automationsFollowUp(
          form.id,
          existing._id,
          difference(target.listIds, before.listIds),
          difference(target.tags, before.tags),
        ),
      };
    }
    case "subscribe": {
      const followUp = await subscribeExisting(existing, target, consent, now, null);
      if (followUp) return { followUp };
      break;
    }
    case "send_confirmation": {
      if (existing.status === "pending") {
        // Not confirmed yet, so the details they typed this time replace the unconfirmed ones.
        const details: Partial<Pick<ContactDoc, "firstName" | "lastName">> & Record<`fields.${string}`, string> = {};
        if (submission.firstName) details.firstName = submission.firstName;
        if (submission.lastName) details.lastName = submission.lastName;
        for (const [key, value] of Object.entries(submission.fields)) details[`fields.${key}`] = value;
        if (Object.keys(details).length > 0) {
          await contacts.updateOne({ _id: existing._id, status: "pending" }, { $set: { ...details, updatedAt: now } });
        }
      }
      return {
        followUp: confirmationFollowUp(
          { _id: existing._id, email: existing.email, firstName: submission.firstName ?? existing.firstName },
          form.id,
        ),
      };
    }
    case "create":
    case "ignore":
      break;
  }
  return { followUp: noFollowUp };
}

// --- Confirmation link -----------------------------------------------------------------

export type ConfirmResult =
  /** Subscribed now, or already was (second click). `form` is null when it was deleted since. */
  | { status: "confirmed" | "already"; form: Form | null; followUp: FollowUp }
  /** Bad signature, unknown contact, too old, or a contact that must not be re-subscribed (bounced, complained, suppressed, unsubscribed after the link was sent). */
  | { status: "invalid" | "expired"; followUp: FollowUp };

/** Handle a click on /c/<token>. Idempotent: a second click changes nothing. */
export async function confirmSubscription(token: string, ip: string | null): Promise<ConfirmResult> {
  const parsed = verifyConfirmToken(await getLinkContext(), token);
  if (!parsed) return { status: "invalid", followUp: noFollowUp };

  const { contacts } = await collections();
  const form = await getForm(parsed.formId);
  const target: FormTarget = {
    id: parsed.formId,
    listIds: form ? await existingListIds(form.listIds) : [],
    tags: form?.tags ?? [],
  };

  // One retry: a concurrent change (e.g. a second click) makes the claim miss once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const contact = await contacts.findOne({ _id: parsed.contactId });
    if (!contact) return { status: "invalid", followUp: noFollowUp };

    const now = new Date();
    const decision = decideConfirmation({
      status: contact.status,
      source: contact.source,
      unsubscribedAt: contact.unsubscribedAt,
      issuedAt: parsed.issuedAt,
      now,
    });
    if (decision === "already") return { status: "already", form, followUp: noFollowUp };
    if (decision === "expired") return { status: "expired", followUp: noFollowUp };
    if (decision === "refused") return { status: "invalid", followUp: noFollowUp };

    // Pending: keep the consent recorded at sign-up. Coming back from
    // unsubscribed: this click is the new consent.
    const consent: ContactConsent =
      contact.status === "pending" && contact.consent
        ? { ...contact.consent, confirmedAt: now }
        : { source: consentSource(parsed.formId), ip, at: parsed.issuedAt, confirmedAt: now };
    const followUp = await subscribeExisting(contact, target, consent, now, parsed.issuedAt);
    if (followUp) return { status: "confirmed", form, followUp };
  }
  return { status: "invalid", followUp: noFollowUp };
}
