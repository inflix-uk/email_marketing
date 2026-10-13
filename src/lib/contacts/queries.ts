import type { CollationOptions } from "mongodb";
import { collections } from "@/db";
import { fromDoc, type Contact, type ContactStatus, type List, type SendStatus } from "@/db/schema";
import { chunk } from "./batch";
import { contactFilter, CONTACTS_PAGE_SIZE, type ContactFilters } from "./filters";

// Read-side queries for the contacts & lists pages and the CSV export.
// Counts, stats and pagination happen in MongoDB (countDocuments /
// aggregation), never by loading whole collections into memory.

export interface Paged<T> {
  rows: T[];
  total: number;
  /** Current page (clamped to the last page). */
  page: number;
  pageCount: number;
  pageSize: number;
}

function paging(total: number, requested: number, pageSize = CONTACTS_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requested), pageCount);
  return { page, pageCount, pageSize, offset: (page - 1) * pageSize };
}

/** Case-insensitive name ordering (like SQL's `collate nocase`). */
const BY_NAME: CollationOptions = { locale: "en", strength: 2 };
const compareNames = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "accent" });

export interface ListRef {
  id: string;
  name: string;
}

/** All lists, alphabetically - for pickers and filters. */
export async function getListOptions(): Promise<ListRef[]> {
  const { lists } = await collections();
  const docs = await lists.find({}, { projection: { name: 1 }, sort: { name: 1 }, collation: BY_NAME }).toArray();
  return docs.map((d) => ({ id: d._id, name: d.name }));
}

// --- Contacts -----------------------------------------------------------------

export async function findContacts(filters: ContactFilters, requestedPage: number) {
  const { contacts } = await collections();
  const filter = contactFilter(filters);
  const total = await contacts.countDocuments(filter);
  const { page, pageCount, pageSize, offset } = paging(total, requestedPage);

  const docs = await contacts
    .find(filter, {
      projection: { email: 1, firstName: 1, lastName: 1, status: 1, createdAt: 1, listIds: 1, tags: 1 },
      sort: { createdAt: -1, email: 1 },
      skip: offset,
      limit: pageSize,
    })
    .toArray();

  const names = await listNamesById(docs.flatMap((d) => d.listIds ?? []));
  const rows = docs.map((d) => ({
    id: d._id,
    email: d.email,
    firstName: d.firstName,
    lastName: d.lastName,
    status: d.status,
    createdAt: d.createdAt,
    tags: [...(d.tags ?? [])].sort(compareNames),
    lists: (d.listIds ?? [])
      .flatMap((id) => (names.has(id) ? [{ id, name: names.get(id)! }] : []))
      .sort((a, b) => compareNames(a.name, b.name)),
  }));
  return { rows, total, page, pageCount, pageSize } satisfies Paged<unknown>;
}

/** Names of the given lists (for the membership badges of a page of contacts). */
async function listNamesById(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { lists } = await collections();
  const docs = await lists.find({ _id: { $in: unique } }, { projection: { name: 1 } }).toArray();
  return new Map(docs.map((d) => [d._id, d.name]));
}

export interface TagOption {
  tag: string;
  count: number;
}

/** Every tag in use with the number of contacts that have it, alphabetically (for the filter and suggestions). */
export async function getTagOptions(limit = 500): Promise<TagOption[]> {
  const { contacts } = await collections();
  const rows = await contacts
    .aggregate<{ _id: string; count: number }>([
      { $match: { tags: { $exists: true, $ne: [] } } },
      { $project: { _id: 0, tags: 1 } },
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $limit: limit },
    ])
    .toArray();
  return rows.map((r) => ({ tag: r._id, count: r.count }));
}

/** Custom field names used by the contacts matching the filters (the export's extra columns). */
export async function exportFieldKeys(filters: ContactFilters): Promise<string[]> {
  const { contacts } = await collections();
  const keys = await contacts
    .aggregate<{ _id: string }>([
      { $match: contactFilter(filters) },
      { $project: { _id: 0, keys: { $map: { input: { $objectToArray: { $ifNull: ["$fields", {}] } }, in: "$$this.k" } } } },
      { $unwind: "$keys" },
      { $group: { _id: "$keys" } },
    ])
    .toArray();
  return keys.map((k) => k._id);
}

/** Cursor over every contact matching the filters, for streaming the CSV export. */
export async function exportContactsCursor(filters: ContactFilters, batchSize = 1000) {
  const { contacts } = await collections();
  return contacts.find(contactFilter(filters), {
    projection: { _id: 0, email: 1, firstName: 1, lastName: 1, status: 1, createdAt: 1, fields: 1, tags: 1 },
    sort: { email: 1 },
    batchSize,
  });
}

export async function getContact(id: string): Promise<Contact | null> {
  const { contacts } = await collections();
  const doc = await contacts.findOne({ _id: id });
  return doc ? { ...fromDoc(doc), fields: doc.fields ?? {}, listIds: doc.listIds ?? [], tags: doc.tags ?? [] } : null;
}

export async function findContactIdByEmail(email: string): Promise<string | null> {
  const { contacts } = await collections();
  const doc = await contacts.findOne({ email }, { projection: { _id: 1 } });
  return doc?._id ?? null;
}

export interface ExistingContact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fields: Record<string, string>;
  status: ContactStatus;
  listIds: string[];
  tags: string[];
}

/** Look up many contacts by (normalised) email, in chunks. */
export async function findContactsByEmail(emails: string[]): Promise<Map<string, ExistingContact>> {
  const found = new Map<string, ExistingContact>();
  if (emails.length === 0) return found;
  const { contacts } = await collections();
  for (const part of chunk(emails)) {
    const docs = await contacts
      .find(
        { email: { $in: part } },
        { projection: { email: 1, firstName: 1, lastName: 1, fields: 1, status: 1, listIds: 1, tags: 1 } },
      )
      .toArray();
    for (const d of docs) {
      found.set(d.email, {
        id: d._id,
        email: d.email,
        firstName: d.firstName ?? null,
        lastName: d.lastName ?? null,
        fields: d.fields ?? {},
        status: d.status,
        listIds: d.listIds ?? [],
        tags: d.tags ?? [],
      });
    }
  }
  return found;
}

export interface ContactActivity {
  id: string;
  campaignId: string;
  campaignName: string;
  status: SendStatus;
  sentAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  openCount: number;
  clickCount: number;
  lastError: string | null;
  createdAt: Date;
}

/** The contact's campaign history, newest first. */
export async function getContactActivity(contactId: string, limit = 100): Promise<ContactActivity[]> {
  const { sends, campaigns } = await collections();
  const rows = await sends
    .aggregate<Omit<ContactActivity, "campaignName">>([
      { $match: { contactId } },
      { $addFields: { sortAt: { $ifNull: ["$sentAt", "$createdAt"] } } },
      { $sort: { sortAt: -1, _id: 1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          id: "$_id",
          campaignId: 1,
          status: 1,
          sentAt: 1,
          openedAt: 1,
          clickedAt: 1,
          openCount: 1,
          clickCount: 1,
          lastError: 1,
          createdAt: 1,
        },
      },
    ])
    .toArray();
  if (rows.length === 0) return [];

  const campaignIds = [...new Set(rows.map((r) => r.campaignId))];
  const found = await campaigns.find({ _id: { $in: campaignIds } }, { projection: { name: 1 } }).toArray();
  const names = new Map(found.map((c) => [c._id, c.name]));
  // Inner-join semantics: sends of a campaign that no longer exists are left out.
  return rows.flatMap((r) => {
    const campaignName = names.get(r.campaignId);
    return campaignName === undefined
      ? []
      : [
          {
            ...r,
            sentAt: r.sentAt ?? null,
            openedAt: r.openedAt ?? null,
            clickedAt: r.clickedAt ?? null,
            openCount: r.openCount ?? 0,
            clickCount: r.clickCount ?? 0,
            lastError: r.lastError ?? null,
            campaignName,
          },
        ];
  });
}

// --- Lists ----------------------------------------------------------------------

export interface ListCounts {
  total: number;
  subscribed: number;
  /** Signed up through a double opt-in form, not confirmed yet. */
  pending: number;
  unsubscribed: number;
  /** Bounced or complained. */
  bounced: number;
}

const NO_MEMBERS: ListCounts = { total: 0, subscribed: 0, pending: 0, unsubscribed: 0, bounced: 0 };

/** Member counts by status for the given lists, in one aggregation. */
export async function getListCounts(listIds: string[]): Promise<Map<string, ListCounts>> {
  const counts = new Map<string, ListCounts>();
  if (listIds.length === 0) return counts;
  const { contacts } = await collections();
  const countWhere = (statuses: ContactStatus[]) => ({ $sum: { $cond: [{ $in: ["$status", statuses] }, 1, 0] } });
  const rows = await contacts
    .aggregate<ListCounts & { _id: string }>([
      { $match: { listIds: { $in: listIds } } },
      { $project: { _id: 0, listIds: 1, status: 1 } },
      { $unwind: "$listIds" },
      { $match: { listIds: { $in: listIds } } },
      {
        $group: {
          _id: "$listIds",
          total: { $sum: 1 },
          subscribed: countWhere(["subscribed"]),
          pending: countWhere(["pending"]),
          unsubscribed: countWhere(["unsubscribed"]),
          bounced: countWhere(["bounced", "complained"]),
        },
      },
    ])
    .toArray();
  for (const { _id, ...c } of rows) counts.set(_id, c);
  return counts;
}

/** All lists with member counts, alphabetically. */
export async function getListsWithCounts() {
  const { lists } = await collections();
  const docs = await lists.find({}, { sort: { name: 1 }, collation: BY_NAME }).toArray();
  const counts = await getListCounts(docs.map((d) => d._id));
  return docs.map((d) => {
    const c = counts.get(d._id) ?? NO_MEMBERS;
    return { id: d._id, name: d.name, description: d.description, createdAt: d.createdAt, total: c.total, subscribed: c.subscribed };
  });
}

export async function getList(id: string): Promise<List | null> {
  const { lists } = await collections();
  const doc = await lists.findOne({ _id: id });
  return doc ? fromDoc(doc) : null;
}

export async function getListStats(listId: string): Promise<ListCounts> {
  return (await getListCounts([listId])).get(listId) ?? NO_MEMBERS;
}

export async function findListMembers(listId: string, q: string | undefined, requestedPage: number) {
  const { contacts } = await collections();
  const filter = contactFilter({ listId, q });
  const total = await contacts.countDocuments(filter);
  const { page, pageCount, pageSize, offset } = paging(total, requestedPage);

  const docs = await contacts
    .find(filter, {
      projection: { email: 1, firstName: 1, lastName: 1, status: 1, createdAt: 1 },
      sort: { createdAt: -1, email: 1 },
      skip: offset,
      limit: pageSize,
    })
    .toArray();
  const rows = docs.map((d) => ({
    id: d._id,
    email: d.email,
    firstName: d.firstName,
    lastName: d.lastName,
    status: d.status,
    createdAt: d.createdAt,
  }));
  return { rows, total, page, pageCount, pageSize } satisfies Paged<unknown>;
}

/** Keep only ids that belong to an existing list. */
export async function existingListIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { lists } = await collections();
  const docs = await lists.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray();
  const found = new Set(docs.map((d) => d._id));
  return ids.filter((id) => found.has(id));
}
