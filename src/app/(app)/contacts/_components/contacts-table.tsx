"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Select } from "@/components/ui/form";
import { Badge, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import type { ContactStatus } from "@/db/schema";
import type { ContactFilters } from "@/lib/contacts/filters";
import type { ListRef } from "@/lib/contacts/queries";
import { formatDate, formatNumber } from "@/lib/utils";
import { bulkContactsAction, type BulkActionInput, type BulkState } from "../actions";
import { ClickableRow } from "./clickable-row";

export interface ContactRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: ContactStatus;
  createdAt: Date;
  lists: ListRef[];
}

type ActionType = BulkActionInput["action"]["type"];

const MAX_LIST_BADGES = 2;
const CHECKBOX = "h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600";

const ACTION_LABELS: Record<ActionType, string> = {
  add_to_list: "Add to list",
  remove_from_list: "Remove from list",
  unsubscribe: "Unsubscribe",
  delete: "Delete",
};

function people(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? "contact" : "contacts"}`;
}

/**
 * The contacts table with row checkboxes and bulk actions. A selection is
 * either the ticked rows of this page or "everyone matching the search"
 * (`allMatching`), which the server resolves from the filters itself.
 * Render it with a `key` that changes with the filters and the page.
 */
export function ContactsTable({
  rows,
  total,
  filters,
  lists,
  empty,
}: {
  rows: ContactRow[];
  /** Contacts matching the current filters, across all pages. */
  total: number;
  filters: ContactFilters;
  lists: ListRef[];
  /** Shown instead of the table when no contact matches (the result of the last action stays visible). */
  empty: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [type, setType] = useState<ActionType>("add_to_list");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<BulkState>({});
  const [pending, startTransition] = useTransition();
  const headerBox = useRef<HTMLInputElement>(null);

  // Rows can disappear after an action (deleted, no longer matching): only count the ones still shown.
  const onPage = rows.filter((r) => selected.has(r.id));
  const pageSelected = rows.length > 0 && onPage.length === rows.length;
  const count = allMatching ? total : onPage.length;

  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = onPage.length > 0 && !pageSelected;
  }, [onPage.length, pageSelected]);

  function clear() {
    setSelected(new Set());
    setAllMatching(false);
    setConfirming(false);
  }

  function toggle(id: string, checked: boolean) {
    setAllMatching(false);
    setConfirming(false);
    setState({});
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setAllMatching(false);
    setConfirming(false);
    setState({});
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  }

  const needsList = type === "add_to_list" || type === "remove_from_list";
  const needsConfirm = type === "delete" || type === "unsubscribe";
  const ready = count > 0 && (!needsList || Boolean(listId));

  function run() {
    const target: BulkActionInput["target"] = allMatching
      ? { filters: { q: filters.q, listId: filters.listId } }
      : { ids: onPage.map((r) => r.id) };
    const action: BulkActionInput["action"] = needsList
      ? { type: type as "add_to_list" | "remove_from_list", listId }
      : { type: type as "unsubscribe" | "delete" };
    startTransition(async () => {
      const result = await bulkContactsAction({ target, action });
      setState(result);
      if (!result.error) clear();
      else setConfirming(false);
    });
  }

  function apply() {
    if (!ready) return;
    if (needsConfirm && !confirming) {
      setConfirming(true);
      return;
    }
    run();
  }

  return (
    <>
      {state.message ? (
        <div className="border-b border-slate-200 px-4 py-3">
          <Alert tone="success">{state.message}</Alert>
        </div>
      ) : null}
      {state.error ? (
        <div className="border-b border-slate-200 px-4 py-3">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}

      {count > 0 ? (
        <div className="space-y-3 border-b border-slate-200 bg-indigo-50/60 px-4 py-3" role="region" aria-label="Bulk actions">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm text-slate-700" aria-live="polite">
              <span className="font-medium text-slate-900">{formatNumber(count)} selected</span>
              {!allMatching && pageSelected && total > rows.length ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => {
                      setAllMatching(true);
                      setConfirming(false);
                    }}
                    className="font-medium text-indigo-600 hover:text-indigo-500"
                  >
                    Select all {formatNumber(total)}
                  </button>
                </>
              ) : null}
              {" · "}
              <button type="button" onClick={clear} className="font-medium text-indigo-600 hover:text-indigo-500">
                Clear
              </button>
            </p>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="bulk-action" className="sr-only">
                Action
              </label>
              <Select
                id="bulk-action"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as ActionType);
                  setConfirming(false);
                }}
                disabled={pending}
                className="sm:w-44"
              >
                {(Object.keys(ACTION_LABELS) as ActionType[]).map((t) => (
                  <option key={t} value={t}>
                    {ACTION_LABELS[t]}
                  </option>
                ))}
              </Select>
              {needsList ? (
                lists.length > 0 ? (
                  <>
                    <label htmlFor="bulk-list" className="sr-only">
                      List
                    </label>
                    <Select id="bulk-list" value={listId} onChange={(e) => setListId(e.target.value)} disabled={pending} className="sm:w-52">
                      {lists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </Select>
                  </>
                ) : (
                  <span className="text-sm text-slate-500">
                    No lists yet -{" "}
                    <Link href="/lists" className="font-medium text-indigo-600 hover:text-indigo-500">
                      create one
                    </Link>
                  </span>
                )
              ) : null}
              {confirming ? null : (
                <Button type="button" onClick={apply} disabled={pending || !ready} variant={type === "delete" ? "danger" : "primary"}>
                  {pending ? "Working..." : "Apply"}
                </Button>
              )}
            </div>
          </div>

          {confirming ? (
            <div className="flex flex-col gap-3 rounded-md bg-red-50 p-3 ring-1 ring-inset ring-red-200 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-red-800">
                {type === "delete"
                  ? `Delete ${people(count)}? This can't be undone.`
                  : `Unsubscribe ${people(count)}? They won't get any more emails.`}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="danger" size="sm" onClick={run} disabled={pending} autoFocus>
                  {pending ? "Working..." : type === "delete" ? "Yes, delete" : "Yes, unsubscribe"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {rows.length === 0 ? empty : null}
      <Table className={rows.length === 0 ? "hidden" : undefined}>
        <thead className="bg-slate-50">
          <tr>
            <Th className="w-10 pr-0">
              <label className="flex items-center">
                <span className="sr-only">Select all contacts on this page</span>
                <input
                  ref={headerBox}
                  type="checkbox"
                  checked={pageSelected}
                  onChange={(e) => togglePage(e.target.checked)}
                  disabled={pending}
                  className={CHECKBOX}
                />
              </label>
            </Th>
            <Th>Email</Th>
            <Th className="hidden sm:table-cell">Name</Th>
            <Th>Status</Th>
            <Th className="hidden lg:table-cell">Lists</Th>
            <Th className="hidden md:table-cell">Added</Th>
          </tr>
        </thead>
        <TBody>
          {rows.map((c) => {
            const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
            const extraLists = c.lists.length - MAX_LIST_BADGES;
            const checked = allMatching || selected.has(c.id);
            return (
              <ClickableRow key={c.id} href={`/contacts/${c.id}`} className={checked ? "bg-indigo-50/40" : undefined}>
                <Td className="w-10 pr-0">
                  <label className="-m-3 flex items-center p-3">
                    <span className="sr-only">Select {c.email}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (allMatching) {
                          // Leaving "select all": fall back to this page minus the row that was unticked.
                          setAllMatching(false);
                          setConfirming(false);
                          setSelected(new Set(rows.filter((r) => r.id !== c.id).map((r) => r.id)));
                        } else {
                          toggle(c.id, e.target.checked);
                        }
                      }}
                      disabled={pending}
                      className={CHECKBOX}
                    />
                  </label>
                </Td>
                <Td className="max-w-xs">
                  <Link href={`/contacts/${c.id}`} className="block truncate font-medium text-slate-900 hover:text-indigo-600">
                    {c.email}
                  </Link>
                  {name ? <span className="block truncate text-xs text-slate-500 sm:hidden">{name}</span> : null}
                </Td>
                <Td className="hidden sm:table-cell">{name || <span className="text-slate-400">—</span>}</Td>
                <Td>
                  <StatusBadge status={c.status} />
                </Td>
                <Td className="hidden lg:table-cell">
                  {c.lists.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {c.lists.slice(0, MAX_LIST_BADGES).map((l) => (
                        <Badge key={l.id} tone="indigo">
                          {l.name}
                        </Badge>
                      ))}
                      {extraLists > 0 ? (
                        <span title={c.lists.slice(MAX_LIST_BADGES).map((l) => l.name).join(", ")}>
                          <Badge>+{extraLists}</Badge>
                        </span>
                      ) : null}
                    </div>
                  )}
                </Td>
                <Td className="hidden whitespace-nowrap text-slate-500 md:table-cell">{formatDate(c.createdAt)}</Td>
              </ClickableRow>
            );
          })}
        </TBody>
      </Table>
    </>
  );
}
