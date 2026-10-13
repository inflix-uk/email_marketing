import type { AnyBulkWriteOperation } from "mongodb";
import { collections } from "@/db";
import { newId, type ContactDoc } from "@/db/schema";
import { bulkOutcome, chunk, forEachConcurrent } from "./batch";
import type { ImportContact } from "./import";
import { addToListByEmail, createList } from "./mutations";
import { findContactsByEmail, getList, type ExistingContact } from "./queries";
import { missingTags, uniqueTags } from "./tags";

// Database side of the CSV import. Takes contacts already produced by
// `mapRows` (validated, lower-cased, de-duplicated) and writes them in chunks
// of ~1000: one lookup (`email $in`), one unordered bulkWrite and one
// membership updateMany per chunk - no per-row round trips. Every write is
// idempotent, so re-running an import that failed half-way is safe.
//
// Rules: new contacts are created as subscribed with source "import" (and an
// "import" consent record); existing contacts keep their status and source
// (an import never re-subscribes anyone - suppressed addresses stay
// unsubscribed); their names/fields are only touched when `updateExisting`
// is on, and empty cells never erase existing data. Tags (from a "Tags"
// column and the "tag everyone" option) are merged with $addToSet for new and
// existing contacts alike - an import never removes a tag. Imports never
// trigger automations.

export class ImportError extends Error {}

export interface ImportOptions {
  /** Add everyone in the file to this existing list... */
  listId?: string | null;
  /** ...or to a new list with this name. */
  newListName?: string | null;
  /** Fill in / overwrite names and custom fields of contacts that already exist. */
  updateExisting: boolean;
  /** Tags added to every contact in the file. */
  tags?: string[];
}

export interface ImportOutcome {
  created: number;
  /** Existing contacts whose details changed. */
  updated: number;
  /** Contacts in the file that already existed (updated or not). */
  existing: number;
  /** Existing contacts that are unsubscribed / bounced / complained (left that way). */
  notSubscribed: number;
  /** New memberships in the target list. */
  addedToList: number;
  /** Existing contacts that received at least one new tag. */
  tagged: number;
  list: { id: string; name: string; created: boolean } | null;
}

type Counts = Omit<ImportOutcome, "list">;

/** How often a chunk is retried when emails keep being inserted concurrently. */
const MAX_ATTEMPTS = 3;
/** Chunks written in parallel: keeps big imports fast without flooding the server. */
const CONCURRENT_CHUNKS = 4;

/** Would importing `incoming` change anything on `current`? */
export function hasChanges(current: Pick<ExistingContact, "firstName" | "lastName" | "fields">, incoming: ImportContact): boolean {
  if (incoming.firstName !== undefined && incoming.firstName !== current.firstName) return true;
  if (incoming.lastName !== undefined && incoming.lastName !== current.lastName) return true;
  return Object.entries(incoming.fields).some(([key, value]) => current.fields?.[key] !== value);
}

/** Tags a row ends up with: its own plus the ones added to everyone. */
export function rowTags(row: Pick<ImportContact, "tags">, extraTags: readonly string[] = []): string[] {
  return uniqueTags([...(row.tags ?? []), ...extraTags]);
}

/** The document a new contact from the file is created as. */
export function newImportedContact(
  row: ImportContact,
  listId: string | null,
  now: Date,
  extraTags: readonly string[] = [],
): ContactDoc {
  return {
    _id: newId(),
    email: row.email,
    firstName: row.firstName ?? null,
    lastName: row.lastName ?? null,
    fields: row.fields,
    status: "subscribed",
    source: "import",
    listIds: listId ? [listId] : [],
    unsubscribedAt: null,
    tags: rowTags(row, extraTags),
    consent: { source: "import", at: now },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * `$set` merging `incoming` into an existing contact, or null when nothing
 * would change. Only non-empty values are set (so an empty cell never erases
 * data), custom fields are merged key by key, and status/source are never
 * touched.
 */
export function importUpdateSet(
  current: Pick<ExistingContact, "firstName" | "lastName" | "fields">,
  incoming: ImportContact,
  now: Date,
): Record<string, unknown> | null {
  if (!hasChanges(current, incoming)) return null;
  const $set: Record<string, unknown> = {};
  if (incoming.firstName !== undefined) $set.firstName = incoming.firstName;
  if (incoming.lastName !== undefined) $set.lastName = incoming.lastName;
  // Keys are validated (letters, digits, underscores), so dotted paths are safe.
  for (const [key, value] of Object.entries(incoming.fields)) $set[`fields.${key}`] = value;
  $set.updatedAt = now;
  return $set;
}

export async function runImport(rows: ImportContact[], opts: ImportOptions): Promise<ImportOutcome> {
  let list: ImportOutcome["list"] = null;
  if (opts.listId) {
    const found = await getList(opts.listId);
    if (!found) throw new ImportError("The selected list no longer exists - choose another one.");
    list = { id: found.id, name: found.name, created: false };
  } else if (opts.newListName) {
    const id = await createList({ name: opts.newListName, description: null });
    list = { id, name: opts.newListName, created: true };
  }

  const counts: Counts = { created: 0, updated: 0, existing: 0, notSubscribed: 0, addedToList: 0, tagged: 0 };
  const now = new Date();
  const extraTags = uniqueTags(opts.tags ?? []);
  // Rows are unique by email, so chunks are independent and can overlap.
  await forEachConcurrent(chunk(rows), CONCURRENT_CHUNKS, (part) =>
    importChunk(part, list?.id ?? null, opts.updateExisting, extraTags, now, counts),
  );
  return { ...counts, list };
}

async function importChunk(
  rows: ImportContact[],
  listId: string | null,
  updateExisting: boolean,
  extraTags: string[],
  now: Date,
  counts: Counts,
): Promise<void> {
  const { contacts } = await collections();
  const existingEmails: string[] = [];
  let pending = rows;

  for (let attempt = 1; pending.length > 0; attempt++) {
    if (attempt > MAX_ATTEMPTS) throw new Error("Contacts kept being created concurrently during the import");
    const existing = await findContactsByEmail(pending.map((r) => r.email));
    const ops: AnyBulkWriteOperation<ContactDoc>[] = [];
    /** The row behind each op, to retry lost insert races. */
    const opRows: ImportContact[] = [];
    /** New tags for existing contacts: written separately so `updated` keeps meaning "details changed". */
    const tagOps: AnyBulkWriteOperation<ContactDoc>[] = [];

    for (const row of pending) {
      const current = existing.get(row.email);
      if (!current) {
        ops.push({ insertOne: { document: newImportedContact(row, listId, now, extraTags) } });
        opRows.push(row);
        continue;
      }
      counts.existing++;
      if (current.status !== "subscribed") counts.notSubscribed++;
      existingEmails.push(row.email);
      const newTags = missingTags(current.tags, rowTags(row, extraTags));
      if (newTags.length > 0) {
        tagOps.push({
          updateOne: { filter: { _id: current.id }, update: { $addToSet: { tags: { $each: newTags } }, $set: { updatedAt: now } } },
        });
      }
      const $set = updateExisting ? importUpdateSet(current, row, now) : null;
      if ($set) {
        ops.push({ updateOne: { filter: { _id: current.id }, update: { $set } } });
        opRows.push(row);
      }
    }
    if (tagOps.length > 0) counts.tagged += (await contacts.bulkWrite(tagOps, { ordered: false })).modifiedCount;
    if (ops.length === 0) break;

    const result = await bulkOutcome(() => contacts.bulkWrite(ops, { ordered: false }));
    counts.created += result.insertedCount;
    counts.updated += result.modifiedCount;
    // New contacts are inserted with the list already set.
    if (listId) counts.addedToList += result.insertedCount;
    // Emails someone else inserted in the meantime: go again, as existing contacts.
    pending = result.duplicateIndexes.map((i) => opRows[i]);
  }

  if (listId && existingEmails.length > 0) counts.addedToList += await addToListByEmail(listId, existingEmails, now);
}
