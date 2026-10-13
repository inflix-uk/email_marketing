import { collections, isDuplicateKeyError } from "@/db";
import { newId, type ContactDoc, type ContactStatus } from "@/db/schema";
import { triggerAutomations } from "@/lib/automations";
import { bulkOutcome, chunk } from "./batch";
import { existingListIds, findContactIdByEmail, findContactsByEmail } from "./queries";
import { missingTags } from "./tags";
import type { ContactInput } from "./validation";

// Write-side logic for contacts and lists. Server actions call these after
// checking the session and validating input. List membership is the embedded
// `contact.listIds` array ($addToSet / $pull); there are no join tables, so
// deletes clean up references themselves.

export type SaveContactResult =
  | { ok: true; id: string; changes: ManualChanges }
  | { ok: false; conflictId: string }
  | { ok: false; notFound: true };

/** What a manual save newly gave a contact - the events automations are told about. */
export interface ManualChanges {
  joinedListIds: string[];
  addedTags: string[];
}

/** Lists joined and tags gained between the stored contact (null = new) and the saved values. */
export function manualChanges(
  before: { listIds?: string[] | null; tags?: string[] | null } | null,
  after: { listIds: string[]; tags: string[] },
): ManualChanges {
  const hadLists = new Set(before?.listIds ?? []);
  return {
    joinedListIds: after.listIds.filter((id) => !hadLists.has(id)),
    addedTags: missingTags(before?.tags, after.tags),
  };
}

/**
 * Tell automations about a contact that was added / edited by hand. Called
 * after the save and only for subscribed contacts; a failure here is logged
 * and never fails the save. Imports, pasted lists, suppression and bulk
 * actions deliberately don't call this.
 */
async function notifyAutomations(contactId: string, status: ContactStatus, changes: ManualChanges): Promise<void> {
  if (status !== "subscribed") return;
  try {
    for (const listId of changes.joinedListIds) {
      await triggerAutomations({ type: "list_joined", listId, contactIds: [contactId] });
    }
    for (const tag of changes.addedTags) {
      await triggerAutomations({ type: "tag_added", tag, contactIds: [contactId] });
    }
  } catch (err) {
    console.error("[contacts] automation trigger failed", err);
  }
}

/** A lost unique-index race on the email: report the contact that won it. */
async function conflictFromDuplicate(err: unknown, email: string): Promise<SaveContactResult> {
  const raced = isDuplicateKeyError(err) ? await findContactIdByEmail(email) : null;
  if (raced) return { ok: false, conflictId: raced };
  throw err;
}

export async function createContact(input: ContactInput): Promise<SaveContactResult> {
  const conflictId = await findContactIdByEmail(input.email);
  if (conflictId) return { ok: false, conflictId };

  const { contacts } = await collections();
  const id = newId();
  const now = new Date();
  const after = { listIds: await existingListIds(input.listIds), tags: input.tags };
  try {
    await contacts.insertOne({
      _id: id,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      fields: input.fields,
      status: "subscribed",
      source: "manual",
      listIds: after.listIds,
      unsubscribedAt: null,
      tags: after.tags,
      consent: { source: "manual", at: now },
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    return conflictFromDuplicate(err, input.email);
  }
  const changes = manualChanges(null, after);
  await notifyAutomations(id, "subscribed", changes);
  return { ok: true, id, changes };
}

/** Update details and replace list memberships and tags. Never changes subscription status. */
export async function updateContact(id: string, input: ContactInput): Promise<SaveContactResult> {
  const { contacts } = await collections();
  if (!(await contacts.countDocuments({ _id: id }, { limit: 1 }))) return { ok: false, notFound: true };
  const otherId = await findContactIdByEmail(input.email);
  if (otherId && otherId !== id) return { ok: false, conflictId: otherId };

  const after = { listIds: await existingListIds(input.listIds), tags: input.tags };
  let before: Pick<ContactDoc, "status" | "listIds" | "tags"> | null;
  try {
    // The document as it was before the save tells us which lists / tags are new.
    before = await contacts.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          fields: input.fields,
          listIds: after.listIds,
          tags: after.tags,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "before", projection: { status: 1, listIds: 1, tags: 1 } },
    );
  } catch (err) {
    return conflictFromDuplicate(err, input.email);
  }
  if (!before) return { ok: false, notFound: true };
  const changes = manualChanges(before, after);
  await notifyAutomations(id, before.status, changes);
  return { ok: true, id, changes };
}

/** Manually opt a subscribed contact out. Returns false if nothing changed. */
export async function unsubscribeContact(id: string): Promise<boolean> {
  const { contacts } = await collections();
  const now = new Date();
  const result = await contacts.updateOne(
    { _id: id, status: "subscribed" },
    { $set: { status: "unsubscribed", unsubscribedAt: now, updatedAt: now } },
  );
  return result.modifiedCount > 0;
}

/**
 * Explicit, consented re-subscribe of an unsubscribed / bounced / complained
 * contact, or manual confirmation of a pending one. The only code path in
 * this area that may set a contact to "subscribed". Records the consent:
 * a pending contact keeps its sign-up consent and gets `confirmedAt`; anyone
 * else gets a fresh "manual" consent. Returns the previous status, or null
 * when nothing changed (not found / already subscribed).
 */
export async function resubscribeContact(id: string): Promise<ContactStatus | null> {
  const { contacts } = await collections();
  const now = new Date();
  const manual = { $literal: { source: "manual", at: now } };
  const before = await contacts.findOneAndUpdate(
    { _id: id, status: { $ne: "subscribed" } },
    [
      {
        $set: {
          status: "subscribed",
          unsubscribedAt: null,
          updatedAt: now,
          source: { $cond: [{ $eq: ["$source", "suppression"] }, "manual", "$source"] },
          consent: {
            $cond: [
              { $eq: ["$status", "pending"] },
              { $mergeObjects: [manual, { $ifNull: ["$consent", {}] }, { confirmedAt: now }] },
              manual,
            ],
          },
        },
      },
    ],
    { returnDocument: "before", projection: { status: 1 } },
  );
  return before?.status ?? null;
}

/** Remove the campaign history (sends and their clicks) and automation enrolments of deleted contacts. */
export async function deleteContactHistory(contactIds: string[]): Promise<void> {
  if (contactIds.length === 0) return;
  const { sends, clicks, enrollments } = await collections();
  const byContact = { contactId: { $in: contactIds } };
  let sendIds: string[] = [];
  const flush = async () => {
    if (sendIds.length > 0) await clicks.deleteMany({ sendId: { $in: sendIds } });
    sendIds = [];
  };
  for await (const send of sends.find(byContact, { projection: { _id: 1 } })) {
    sendIds.push(send._id);
    if (sendIds.length >= 1000) await flush();
  }
  await flush();
  await sends.deleteMany(byContact);
  await enrollments.deleteMany(byContact);
}

/** Deletes the contact and its campaign history (sends and their clicks). */
export async function deleteContact(id: string): Promise<boolean> {
  const { contacts } = await collections();
  const deleted = await contacts.deleteOne({ _id: id });
  if (deleted.deletedCount === 0) return false;
  await deleteContactHistory([id]);
  return true;
}

// --- Lists ------------------------------------------------------------------------

export interface ListInput {
  name: string;
  description: string | null;
}

export async function createList(input: ListInput): Promise<string> {
  const { lists } = await collections();
  const id = newId();
  const now = new Date();
  await lists.insertOne({ _id: id, name: input.name, description: input.description, createdAt: now, updatedAt: now });
  return id;
}

export async function updateList(id: string, input: ListInput): Promise<boolean> {
  const { lists } = await collections();
  const result = await lists.updateOne(
    { _id: id },
    { $set: { name: input.name, description: input.description, updatedAt: new Date() } },
  );
  return result.matchedCount > 0;
}

/** Deletes the list and every reference to it; the contacts themselves are kept. */
export async function deleteList(id: string): Promise<boolean> {
  const { lists, contacts, campaigns, forms } = await collections();
  const deleted = await lists.deleteOne({ _id: id });
  // Clean up references even when the list was already gone (e.g. a retried delete).
  const now = new Date();
  await contacts.updateMany({ listIds: id }, { $pull: { listIds: id }, $set: { updatedAt: now } });
  await campaigns.updateMany({ listIds: id }, { $pull: { listIds: id }, $set: { updatedAt: now } });
  await forms.updateMany({ listIds: id }, { $pull: { listIds: id } });
  return deleted.deletedCount > 0;
}

export async function removeListMember(listId: string, contactId: string): Promise<boolean> {
  const { contacts } = await collections();
  const result = await contacts.updateOne(
    { _id: contactId, listIds: listId },
    { $pull: { listIds: listId }, $set: { updatedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

/**
 * Add the existing contacts with these emails to a list, in chunks. Contacts
 * already on it are left alone. Returns how many memberships were added.
 */
export async function addToListByEmail(listId: string, emails: string[], now = new Date()): Promise<number> {
  const { contacts } = await collections();
  let added = 0;
  for (const part of chunk(emails)) {
    const result = await contacts.updateMany(
      { email: { $in: part }, listIds: { $ne: listId } },
      { $addToSet: { listIds: listId }, $set: { updatedAt: now } },
    );
    added += result.modifiedCount;
  }
  return added;
}

export interface AddEmailsResult {
  /** New contacts created (subscribed, source "manual"). */
  created: number;
  /** New memberships in the list. */
  added: number;
  alreadyInList: number;
  /** Existing contacts that were added but are pending / unsubscribed / bounced / complained. */
  notSubscribed: number;
}

/**
 * Add pasted addresses (already validated + normalised) to a list: known
 * contacts are added as they are (their status is never changed), unknown
 * addresses become new subscribed contacts.
 */
export async function addEmailsToList(listId: string, emails: string[]): Promise<AddEmailsResult> {
  const { contacts } = await collections();
  const existing = await findContactsByEmail(emails);
  const now = new Date();

  let created = 0;
  const newEmails = emails.filter((e) => !existing.has(e));
  for (const part of chunk(newEmails)) {
    const docs: ContactDoc[] = part.map((email) => ({
      _id: newId(),
      email,
      firstName: null,
      lastName: null,
      fields: {},
      status: "subscribed",
      source: "manual",
      listIds: [listId],
      unsubscribedAt: null,
      tags: [],
      consent: { source: "manual", at: now },
      createdAt: now,
      updatedAt: now,
    }));
    // Addresses created concurrently by someone else fail on the unique index
    // and are simply added to the list below, like any existing contact.
    const outcome = await bulkOutcome(() => contacts.insertMany(docs, { ordered: false }).then((r) => ({ insertedCount: r.insertedCount, modifiedCount: 0 })));
    created += outcome.insertedCount;
  }

  // New contacts were inserted with the list already set, so this only touches
  // existing (or concurrently created) contacts that aren't members yet.
  const added = created + (await addToListByEmail(listId, emails, now));
  return {
    created,
    added,
    alreadyInList: emails.length - added,
    notSubscribed: [...existing.values()].filter((c) => c.status !== "subscribed").length,
  };
}

// --- Suppression list ---------------------------------------------------------------

export interface SuppressResult {
  /** Existing subscribed / pending contacts that were unsubscribed. */
  unsubscribed: number;
  /** Unknown addresses stored as unsubscribed contacts (source "suppression"). */
  created: number;
  /** Addresses that were already unsubscribed, bounced or complained. */
  alreadySuppressed: number;
}

/** The contact an unknown suppressed address is stored as: it exists only so it can never be emailed. */
export function suppressedContact(email: string, now: Date): ContactDoc {
  return {
    _id: newId(),
    email,
    firstName: null,
    lastName: null,
    fields: {},
    status: "unsubscribed",
    source: "suppression",
    listIds: [],
    unsubscribedAt: now,
    tags: [],
    consent: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Make sure these addresses (validated + normalised) are never emailed:
 * existing subscribed / pending contacts become "unsubscribed"; unknown
 * addresses are created as "unsubscribed" so a later import or pasted list
 * finds them and leaves them that way. Never triggers automations.
 */
export async function suppressEmails(emails: string[]): Promise<SuppressResult> {
  const { contacts } = await collections();
  const existing = await findContactsByEmail(emails);
  const now = new Date();

  let created = 0;
  for (const part of chunk(emails.filter((e) => !existing.has(e)))) {
    const docs = part.map((email) => suppressedContact(email, now));
    // An address created concurrently by someone else fails on the unique
    // index and is unsubscribed below like any other existing contact.
    const outcome = await bulkOutcome(() =>
      contacts.insertMany(docs, { ordered: false }).then((r) => ({ insertedCount: r.insertedCount, modifiedCount: 0 })),
    );
    created += outcome.insertedCount;
  }

  let unsubscribed = 0;
  for (const part of chunk(emails)) {
    const result = await contacts.updateMany(
      { email: { $in: part }, status: { $in: ["subscribed", "pending"] } },
      { $set: { status: "unsubscribed", unsubscribedAt: now, updatedAt: now } },
    );
    unsubscribed += result.modifiedCount;
    // Mark every listed contact (whatever its status) so sign-up forms and
    // confirmation links can never bring it back - only a manual re-subscribe can.
    await contacts.updateMany(
      { email: { $in: part }, source: { $ne: "suppression" } },
      { $set: { source: "suppression", updatedAt: now } },
    );
  }
  return { unsubscribed, created, alreadySuppressed: Math.max(0, emails.length - created - unsubscribed) };
}
