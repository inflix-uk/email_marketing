import { collections, isDuplicateKeyError } from "@/db";
import { newId, type ContactDoc } from "@/db/schema";
import { bulkOutcome, chunk } from "./batch";
import { existingListIds, findContactIdByEmail, findContactsByEmail } from "./queries";
import type { ContactInput } from "./validation";

// Write-side logic for contacts and lists. Server actions call these after
// checking the session and validating input. List membership is the embedded
// `contact.listIds` array ($addToSet / $pull); there are no join tables, so
// deletes clean up references themselves.

export type SaveContactResult = { ok: true; id: string } | { ok: false; conflictId: string } | { ok: false; notFound: true };

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
  try {
    await contacts.insertOne({
      _id: id,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      fields: input.fields,
      status: "subscribed",
      source: "manual",
      listIds: await existingListIds(input.listIds),
      unsubscribedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    return conflictFromDuplicate(err, input.email);
  }
  return { ok: true, id };
}

/** Update details and replace list memberships. Never changes subscription status. */
export async function updateContact(id: string, input: ContactInput): Promise<SaveContactResult> {
  const { contacts } = await collections();
  if (!(await contacts.countDocuments({ _id: id }, { limit: 1 }))) return { ok: false, notFound: true };
  const otherId = await findContactIdByEmail(input.email);
  if (otherId && otherId !== id) return { ok: false, conflictId: otherId };

  try {
    const result = await contacts.updateOne(
      { _id: id },
      {
        $set: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          fields: input.fields,
          listIds: await existingListIds(input.listIds),
          updatedAt: new Date(),
        },
      },
    );
    if (result.matchedCount === 0) return { ok: false, notFound: true };
  } catch (err) {
    return conflictFromDuplicate(err, input.email);
  }
  return { ok: true, id };
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
 * contact. The only code path that may set a contact back to "subscribed".
 */
export async function resubscribeContact(id: string): Promise<boolean> {
  const { contacts } = await collections();
  const result = await contacts.updateOne(
    { _id: id, status: { $ne: "subscribed" } },
    { $set: { status: "subscribed", unsubscribedAt: null, updatedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

/** Deletes the contact and its campaign history (sends and their clicks). */
export async function deleteContact(id: string): Promise<boolean> {
  const { contacts, sends, clicks } = await collections();
  const deleted = await contacts.deleteOne({ _id: id });
  if (deleted.deletedCount === 0) return false;
  const sendIds = await sends.distinct("_id", { contactId: id });
  for (const part of chunk(sendIds)) await clicks.deleteMany({ sendId: { $in: part } });
  await sends.deleteMany({ contactId: id });
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
  const { lists, contacts, campaigns } = await collections();
  const deleted = await lists.deleteOne({ _id: id });
  // Clean up references even when the list was already gone (e.g. a retried delete).
  const now = new Date();
  await contacts.updateMany({ listIds: id }, { $pull: { listIds: id }, $set: { updatedAt: now } });
  await campaigns.updateMany({ listIds: id }, { $pull: { listIds: id }, $set: { updatedAt: now } });
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
  /** Existing contacts that were added but are unsubscribed / bounced / complained. */
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
