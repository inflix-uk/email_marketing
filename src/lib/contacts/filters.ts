import type { Filter } from "mongodb";
import { CONTACT_STATUSES, type ContactDoc, type ContactStatus } from "@/db/schema";

// Filters shared by the contacts table, its pagination and the CSV export
// (?q= ?status= ?list= ?page=). Builds MongoDB filters but never touches the
// connection, so it is safe to import from client components and tests.

export const CONTACTS_PAGE_SIZE = 50;

export interface ContactFilters {
  q?: string;
  status?: ContactStatus;
  listId?: string;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Read filters from URL search params, dropping anything invalid. */
export function parseContactFilters(params: RawParams | URLSearchParams): ContactFilters {
  const get = (key: string) =>
    params instanceof URLSearchParams ? (params.get(key)?.trim() ?? "") : first(params[key]);
  const q = get("q").slice(0, 200);
  const status = get("status");
  const listId = get("list");
  return {
    q: q || undefined,
    status: (CONTACT_STATUSES as readonly string[]).includes(status) ? (status as ContactStatus) : undefined,
    listId: listId || undefined,
  };
}

/** 1-based page number from ?page=, defaulting to 1. */
export function parsePage(value: string | string[] | undefined): number {
  const n = Number.parseInt(first(value), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function hasFilters(f: ContactFilters): boolean {
  return Boolean(f.q || f.status || f.listId);
}

/** Query-string for the given filters (and optional page), without a leading "?". */
export function filtersToSearchParams(f: ContactFilters, page?: number): URLSearchParams {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.status) params.set("status", f.status);
  if (f.listId) params.set("list", f.listId);
  if (page && page > 1) params.set("page", String(page));
  return params;
}

/** Escape regex metacharacters so user input matches literally in `$regex`. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive "contains" match on email, first name, last name, or "first last". */
export function contactSearchFilter(term: string): Filter<ContactDoc> {
  const pattern = escapeRegex(term);
  const contains = { $regex: pattern, $options: "i" };
  const clauses: Filter<ContactDoc>[] = [{ email: contains }, { firstName: contains }, { lastName: contains }];
  // A term without whitespace can't span the space between first and last
  // name, so the (unindexable) full-name expression is only needed otherwise.
  if (/\s/.test(term)) {
    clauses.push({
      $expr: {
        $regexMatch: {
          input: { $concat: [{ $ifNull: ["$firstName", ""] }, " ", { $ifNull: ["$lastName", ""] }] },
          regex: pattern,
          options: "i",
        },
      },
    });
  }
  return { $or: clauses };
}

/** MongoDB filter on the contacts collection for the given filters. */
export function contactFilter(f: ContactFilters): Filter<ContactDoc> {
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(f.listId ? { listIds: f.listId } : {}),
    ...(f.q ? contactSearchFilter(f.q) : {}),
  };
}
