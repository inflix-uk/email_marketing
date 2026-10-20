import type { Document, Filter, UpdateFilter } from "mongodb";
import { collections } from "@/db";
import type { ContactDoc } from "@/db/schema";
import { contactFilter, type ContactFilters } from "./filters";
import { deleteContactHistory } from "./mutations";

// Bulk actions on the contacts table. The target is either the ticked rows
// (ids, at most MAX_BULK_IDS) or "everyone matching the current filter".
// Everything runs as updateMany / deleteMany in the database. Bulk actions
// never re-subscribe anyone and never trigger automations.

export const MAX_BULK_IDS = 500;
/** Contacts deleted per round trip when deleting by filter. */
const DELETE_BATCH = 500;

export type BulkTarget = { ids: string[] } | { filters: ContactFilters };

export const BULK_ACTION_TYPES = ["add_to_list", "remove_from_list", "add_tag", "remove_tag", "subscribe", "unsubscribe", "delete"] as const;
export type BulkActionType = (typeof BULK_ACTION_TYPES)[number];

export type BulkAction =
  | { type: "add_to_list"; listId: string }
  | { type: "remove_from_list"; listId: string }
  | { type: "add_tag"; tag: string }
  | { type: "remove_tag"; tag: string }
  /** Explicit, confirmed re-subscribe by a person (never a side effect). */
  | { type: "subscribe" }
  | { type: "unsubscribe" }
  | { type: "delete" };

export class BulkError extends Error {}

export interface BulkResult {
  /** Contacts the selection covers. */
  matched: number;
  /** Contacts the action actually changed (or deleted). */
  changed: number;
}

/** MongoDB filter for the selected contacts. */
export function bulkTargetFilter(target: BulkTarget): Filter<ContactDoc> {
  if ("ids" in target) return { _id: { $in: [...new Set(target.ids)] } };
  return contactFilter(target.filters);
}

/**
 * For every action except delete: `only` narrows the selection to contacts
 * the action would really change (so `modifiedCount` is honest and
 * `updatedAt` isn't bumped for nothing) and `update` is what to apply.
 */
export function bulkUpdatePlan(
  action: Exclude<BulkAction, { type: "delete" }>,
  now: Date,
): { only: Filter<ContactDoc>; update: UpdateFilter<ContactDoc> | Document[] } {
  switch (action.type) {
    case "add_to_list":
      return { only: { listIds: { $ne: action.listId } }, update: { $addToSet: { listIds: action.listId }, $set: { updatedAt: now } } };
    case "remove_from_list":
      return { only: { listIds: action.listId }, update: { $pull: { listIds: action.listId }, $set: { updatedAt: now } } };
    case "add_tag":
      return { only: { tags: { $ne: action.tag } }, update: { $addToSet: { tags: action.tag }, $set: { updatedAt: now } } };
    case "remove_tag":
      return { only: { tags: action.tag }, update: { $pull: { tags: action.tag }, $set: { updatedAt: now } } };
    case "subscribe":
      // Unsubscribed / pending only: bounced and complained addresses stay blocked.
      // A pipeline update, so a "suppression" source becomes "manual" like a single re-subscribe.
      return {
        only: { status: { $in: ["unsubscribed", "pending"] } },
        update: [
          {
            $set: {
              status: "subscribed",
              unsubscribedAt: null,
              updatedAt: now,
              source: { $cond: [{ $eq: ["$source", "suppression"] }, "manual", "$source"] },
              consent: { $literal: { source: "manual", at: now } },
            },
          },
        ],
      };
    case "unsubscribe":
      // Only ever moves people out of the mailable statuses; bounced / complained keep their status.
      return {
        only: { status: { $in: ["subscribed", "pending"] } },
        update: { $set: { status: "unsubscribed", unsubscribedAt: now, updatedAt: now } },
      };
  }
}

/** Selection AND "would change": kept as two clauses so their keys (e.g. listIds) can't clash. */
export function bulkChangeFilter(target: BulkTarget, only: Filter<ContactDoc>): Filter<ContactDoc> {
  return { $and: [bulkTargetFilter(target), only] };
}

/** Problem with a selection, or null. */
export function bulkTargetError(target: BulkTarget): string | null {
  if (!("ids" in target)) return null;
  if (target.ids.length === 0) return "Select at least one contact.";
  if (target.ids.length > MAX_BULK_IDS) return `Select at most ${MAX_BULK_IDS} contacts at a time, or use "Select all matching".`;
  return null;
}

export async function runBulkAction(target: BulkTarget, action: BulkAction): Promise<BulkResult> {
  const problem = bulkTargetError(target);
  if (problem) throw new BulkError(problem);

  const { contacts, lists } = await collections();
  if (action.type === "add_to_list" && !(await lists.countDocuments({ _id: action.listId }, { limit: 1 }))) {
    throw new BulkError("That list no longer exists - choose another one.");
  }

  const selection = bulkTargetFilter(target);
  if (action.type === "delete") {
    const deleted = await deleteContactsWhere(selection);
    return { matched: deleted, changed: deleted };
  }

  const matched = await contacts.countDocuments(selection);
  const { only, update } = bulkUpdatePlan(action, new Date());
  const result = await contacts.updateMany(bulkChangeFilter(target, only), update);
  return { matched, changed: result.modifiedCount };
}

/** Delete every contact matching `filter` together with its sends, clicks and enrolments, batch by batch. */
async function deleteContactsWhere(filter: Filter<ContactDoc>): Promise<number> {
  const { contacts } = await collections();
  let deleted = 0;
  for (;;) {
    const batch = await contacts.find(filter, { projection: { _id: 1 }, limit: DELETE_BATCH }).toArray();
    if (batch.length === 0) break;
    const ids = batch.map((d) => d._id);
    const result = await contacts.deleteMany({ _id: { $in: ids } });
    await deleteContactHistory(ids);
    deleted += result.deletedCount;
    // Nothing deleted although something matched: stop rather than loop forever.
    if (result.deletedCount === 0 || batch.length < DELETE_BATCH) break;
  }
  return deleted;
}
