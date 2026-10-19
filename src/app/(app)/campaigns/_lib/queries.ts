import type { Filter, Sort } from "mongodb";
import { cache } from "react";
import { collections } from "@/db";
import { fromDoc, type CampaignStatus, type SendDoc, type SendStatus } from "@/db/schema";

// Read-side helpers shared by the campaign pages and actions.

/** Statuses whose content can still be changed. */
export const EDITABLE_STATUSES: CampaignStatus[] = ["draft", "scheduled"];

export function isEditable(status: CampaignStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** Deduplicated per request, so generateMetadata and the page share one query. */
export const getCampaign = cache(async (id: string) => {
  const { campaigns } = await collections();
  const doc = await campaigns.findOne({ _id: id });
  return doc ? fromDoc(doc) : undefined;
});

/** Case-insensitive sort on list names. */
const NAME_COLLATION = { locale: "en", strength: 2 } as const;

export interface ListOption {
  id: string;
  name: string;
  /** Subscribed contacts on the list. */
  subscribed: number;
}

/** Every list with its number of subscribed contacts, alphabetically. */
export async function getListsWithCounts(): Promise<ListOption[]> {
  const { lists, contacts } = await collections();
  const [rows, counts] = await Promise.all([
    lists.find({}, { projection: { name: 1 } }).collation(NAME_COLLATION).sort({ name: 1 }).toArray(),
    contacts
      .aggregate<{ _id: string; n: number }>([
        { $match: { status: "subscribed" } },
        { $unwind: "$listIds" },
        { $group: { _id: "$listIds", n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const byList = new Map(counts.map((c) => [c._id, c.n]));
  return rows.map((l) => ({ id: l._id, name: l.name, subscribed: byList.get(l._id) ?? 0 }));
}

/** The ids (in the given order) that still belong to an existing list. */
export async function existingListIds(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { lists } = await collections();
  const found = new Set(
    (await lists.find({ _id: { $in: unique } }, { projection: { _id: 1 } }).toArray()).map((l) => l._id),
  );
  return unique.filter((id) => found.has(id));
}

/** Names of the given lists (deleted ones are skipped), alphabetically. */
export async function getListNames(listIds: string[]): Promise<{ id: string; name: string }[]> {
  if (listIds.length === 0) return [];
  const { lists } = await collections();
  const rows = await lists
    .find({ _id: { $in: [...new Set(listIds)] } }, { projection: { name: 1 } })
    .collation(NAME_COLLATION)
    .sort({ name: 1 })
    .toArray();
  return rows.map((l) => ({ id: l._id, name: l.name }));
}

// --- Report: recipients table -----------------------------------------------

export const RECIPIENT_FILTERS = ["all", "opened", "clicked", "unsubscribed", "bounced", "failed"] as const;
export type RecipientFilter = (typeof RECIPIENT_FILTERS)[number];

export const RECIPIENTS_PAGE_SIZE = 50;

function recipientFilterQuery(filter: RecipientFilter): Filter<SendDoc> {
  switch (filter) {
    case "opened":
      return { openedAt: { $ne: null } };
    case "clicked":
      return { clickedAt: { $ne: null } };
    case "unsubscribed":
      return { unsubscribedAt: { $ne: null } };
    case "bounced":
      return { bouncedAt: { $ne: null } };
    case "failed":
      return { status: { $in: ["failed", "skipped"] } };
    default:
      return {};
  }
}

// `_id` last keeps pagination stable when the sort keys tie. A descending sort
// puts null/missing dates last, like "nulls last".
function recipientSort(filter: RecipientFilter): Sort {
  switch (filter) {
    case "opened":
      return { openedAt: -1, _id: 1 };
    case "clicked":
      return { clickedAt: -1, _id: 1 };
    case "unsubscribed":
      return { unsubscribedAt: -1, _id: 1 };
    case "bounced":
      return { bouncedAt: -1, _id: 1 };
    case "failed":
      return { updatedAt: -1, _id: 1 };
    default:
      return { sentAt: -1, email: 1, _id: 1 };
  }
}

export interface RecipientRow {
  id: string;
  contactId: string;
  email: string;
  status: SendStatus;
  lastError: string | null;
  sentAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  unsubscribedAt: Date | null;
  bouncedAt: Date | null;
  complainedAt: Date | null;
  variant: "A" | "B" | null;
  openCount: number;
  clickCount: number;
}

export async function getRecipientsPage(campaignId: string, filter: RecipientFilter, page: number) {
  const { sends } = await collections();
  const query: Filter<SendDoc> = { campaignId, ...recipientFilterQuery(filter) };
  const total = await sends.countDocuments(query);
  const pageCount = Math.max(1, Math.ceil(total / RECIPIENTS_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const docs = await sends
    .find(query, {
      projection: {
        contactId: 1,
        email: 1,
        status: 1,
        lastError: 1,
        sentAt: 1,
        openedAt: 1,
        clickedAt: 1,
        unsubscribedAt: 1,
        bouncedAt: 1,
        complainedAt: 1,
        variant: 1,
        openCount: 1,
        clickCount: 1,
      },
    })
    .sort(recipientSort(filter))
    .skip((current - 1) * RECIPIENTS_PAGE_SIZE)
    .limit(RECIPIENTS_PAGE_SIZE)
    .toArray();
  const rows: RecipientRow[] = docs.map((d) => ({
    id: d._id,
    contactId: d.contactId,
    email: d.email,
    status: d.status,
    lastError: d.lastError ?? null,
    sentAt: d.sentAt ?? null,
    openedAt: d.openedAt ?? null,
    clickedAt: d.clickedAt ?? null,
    unsubscribedAt: d.unsubscribedAt ?? null,
    bouncedAt: d.bouncedAt ?? null,
    complainedAt: d.complainedAt ?? null,
    variant: d.variant ?? null,
    openCount: d.openCount ?? 0,
    clickCount: d.clickCount ?? 0,
  }));
  return { rows, total, page: current, pageCount };
}

/** Parse "?page=" safely. */
export function parsePage(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
