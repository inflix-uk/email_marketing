import { z } from "zod";
import { collections, isDuplicateKeyError } from "@/db";
import { newId, type ContactDoc } from "@/db/schema";
import { triggerAutomations } from "@/lib/automations";
import { MAX_TAG_LENGTH, tagError, uniqueTags } from "@/lib/contacts/tags";
import { emailSchema, fieldKeyError, MAX_FIELD_VALUE_LENGTH } from "@/lib/contacts/validation";

// Data access for the public REST API (/api/v1): contacts are created or
// updated by email. The API never changes the status of an existing contact,
// so an unsubscribed / bounced / complained address is never re-subscribed.

// --- Input ----------------------------------------------------------------------

/** undefined = leave as it is; null or "" = clear. */
const optionalName = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    const name = (v ?? "").trim();
    if (name.length > 100) {
      ctx.addIssue({ code: "custom", message: "Keep names under 100 characters." });
      return z.NEVER;
    }
    return name || null;
  });

const fieldsSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .optional()
  .transform((raw, ctx) => {
    const set: Record<string, string> = {};
    const unset: string[] = [];
    const entries = Object.entries(raw ?? {});
    if (entries.length > 50) {
      ctx.addIssue({ code: "custom", message: "Send at most 50 fields." });
      return z.NEVER;
    }
    for (const [key, value] of entries) {
      const problem = fieldKeyError(key);
      if (problem) {
        ctx.addIssue({ code: "custom", message: problem });
        return z.NEVER;
      }
      const text = value === null ? "" : String(value).trim();
      if (text.length > MAX_FIELD_VALUE_LENGTH) {
        ctx.addIssue({ code: "custom", message: `The value of "${key}" is too long.` });
        return z.NEVER;
      }
      if (text) set[key] = text;
      else unset.push(key);
    }
    return { set, unset };
  });

const tagsSchema = z
  .array(z.string())
  .max(50, "Send at most 50 tags.")
  .optional()
  .transform((raw, ctx) => {
    const tags = uniqueTags(raw ?? []);
    for (const tag of tags) {
      const problem = tagError(tag);
      if (problem) {
        ctx.addIssue({ code: "custom", message: `Tag "${tag.slice(0, MAX_TAG_LENGTH)}": ${problem}` });
        return z.NEVER;
      }
    }
    return tags;
  });

export const apiContactSchema = z.object({
  email: emailSchema,
  first_name: optionalName,
  last_name: optionalName,
  fields: fieldsSchema,
  tags: tagsSchema,
  /** List ids or names. */
  lists: z
    .array(z.string().trim().min(1).max(100))
    .max(50, "Send at most 50 lists.")
    .optional()
    .transform((v) => [...new Set(v ?? [])]),
});

export type ApiContactInput = z.output<typeof apiContactSchema>;

/** "email: Enter a valid email address..." for the first problem found. */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue?.path[0];
  const message = issue?.message ?? "The request is not valid.";
  return typeof field === "string" ? `${field}: ${message}` : message;
}

// --- Output ----------------------------------------------------------------------

export interface ApiContact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  fields: Record<string, string>;
  tags: string[];
  lists: { id: string; name: string }[];
  created_at: string;
  updated_at: string;
}

async function toApiContact(doc: ContactDoc): Promise<ApiContact> {
  const { lists } = await collections();
  const listIds = doc.listIds ?? [];
  const names = listIds.length
    ? await lists.find({ _id: { $in: listIds } }, { projection: { name: 1 } }).toArray()
    : [];
  const byId = new Map(names.map((l) => [l._id, l.name]));
  return {
    id: doc._id,
    email: doc.email,
    first_name: doc.firstName,
    last_name: doc.lastName,
    status: doc.status,
    fields: doc.fields ?? {},
    tags: doc.tags ?? [],
    lists: listIds.flatMap((id) => (byId.has(id) ? [{ id, name: byId.get(id)! }] : [])),
    created_at: doc.createdAt.toISOString(),
    updated_at: doc.updatedAt.toISOString(),
  };
}

export async function findApiContact(email: string): Promise<ApiContact | null> {
  const { contacts } = await collections();
  const doc = await contacts.findOne({ email });
  return doc ? toApiContact(doc) : null;
}

export interface ApiList {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export async function getApiLists(): Promise<ApiList[]> {
  const { lists } = await collections();
  const docs = await lists.find({}, { sort: { name: 1 }, collation: { locale: "en", strength: 2 } }).toArray();
  return docs.map((d) => ({ id: d._id, name: d.name, description: d.description, created_at: d.createdAt.toISOString() }));
}

// --- Upsert ----------------------------------------------------------------------

/**
 * Match `lists` entries (ids or names, names case-insensitive) to real lists.
 * Pure: `all` is every list. Returns the ids, and the entries that match nothing.
 */
export function resolveLists(
  entries: readonly string[],
  all: readonly { id: string; name: string }[],
): { ids: string[]; unknown: string[] } {
  const byId = new Map(all.map((l) => [l.id, l.id]));
  const byName = new Map<string, string>();
  // First list wins when two share a name.
  for (const l of all) if (!byName.has(l.name.trim().toLowerCase())) byName.set(l.name.trim().toLowerCase(), l.id);

  const ids = new Set<string>();
  const unknown: string[] = [];
  for (const entry of entries) {
    const id = byId.get(entry) ?? byName.get(entry.trim().toLowerCase());
    if (id) ids.add(id);
    else unknown.push(entry);
  }
  return { ids: [...ids], unknown };
}

export type UpsertResult =
  | { ok: true; created: boolean; contact: ApiContact }
  | { ok: false; code: "unknown_list"; message: string };

export async function upsertApiContact(input: ApiContactInput): Promise<UpsertResult> {
  const { contacts, lists } = await collections();

  let listIds: string[] = [];
  if (input.lists.length > 0) {
    const all = await lists.find({}, { projection: { name: 1 } }).toArray();
    const resolved = resolveLists(input.lists, all.map((l) => ({ id: l._id, name: l.name })));
    if (resolved.unknown.length > 0) {
      return {
        ok: false,
        code: "unknown_list",
        message: `Unknown list: ${resolved.unknown.map((l) => `"${l}"`).join(", ")}. Use a list id or its exact name (GET /api/v1/lists).`,
      };
    }
    listIds = resolved.ids;
  }

  const now = new Date();
  let before = await contacts.findOne({ email: input.email });

  if (!before) {
    const doc: ContactDoc = {
      _id: newId(),
      email: input.email,
      firstName: input.first_name ?? null,
      lastName: input.last_name ?? null,
      fields: input.fields.set,
      status: "subscribed",
      source: "api",
      listIds,
      tags: input.tags,
      consent: { source: "api", ip: null, at: now, confirmedAt: null },
      unsubscribedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await contacts.insertOne(doc);
      await notifyAutomations(doc._id, listIds, input.tags);
      return { ok: true, created: true, contact: await toApiContact(doc) };
    } catch (err) {
      // Created by someone else at the same moment: update that contact instead.
      before = isDuplicateKeyError(err) ? await contacts.findOne({ email: input.email }) : null;
      if (!before) throw err;
    }
  }

  // Existing contact: update details, add lists and tags. The status is never touched.
  const existing: ContactDoc = before;
  const $set: Partial<Pick<ContactDoc, "firstName" | "lastName" | "updatedAt">> & Record<`fields.${string}`, string> = {
    updatedAt: now,
  };
  if (input.first_name !== undefined) $set.firstName = input.first_name;
  if (input.last_name !== undefined) $set.lastName = input.last_name;
  for (const [key, value] of Object.entries(input.fields.set)) $set[`fields.${key}`] = value;
  const $unset: Record<`fields.${string}`, ""> = {};
  for (const key of input.fields.unset) $unset[`fields.${key}`] = "";

  const after = await contacts.findOneAndUpdate(
    { _id: existing._id },
    {
      $set,
      ...(input.fields.unset.length > 0 ? { $unset } : {}),
      $addToSet: { listIds: { $each: listIds }, tags: { $each: input.tags } },
    },
    { returnDocument: "after" },
  );
  if (!after) throw new Error("The contact was deleted while it was being updated.");

  if (after.status === "subscribed") {
    await notifyAutomations(
      after._id,
      listIds.filter((id) => !(existing.listIds ?? []).includes(id)),
      input.tags.filter((tag) => !(existing.tags ?? []).includes(tag)),
    );
  }
  return { ok: true, created: false, contact: await toApiContact(after) };
}

/** Start automations for the lists / tags a subscribed contact just got. Never throws. */
async function notifyAutomations(contactId: string, joinedListIds: string[], addedTags: string[]): Promise<void> {
  const contactIds = [contactId];
  for (const listId of joinedListIds) await triggerAutomations({ type: "list_joined", listId, contactIds });
  for (const tag of addedTags) await triggerAutomations({ type: "tag_added", tag, contactIds });
}
