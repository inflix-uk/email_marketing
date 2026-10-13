"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { cn, formatNumber } from "@/lib/utils";
import { estimateRecipients } from "../actions";
import type { ListOption } from "../_lib/queries";

/** List checkboxes (submitted as `listIds`) with a live distinct-recipient total. */
export function AudiencePicker({
  lists,
  initialSelected,
  initialCount,
  error,
  onEdit,
}: {
  lists: ListOption[];
  initialSelected: string[];
  initialCount: number;
  error?: string;
  /** Called for changes that don't fire a native change event (select all / clear). */
  onEdit: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [count, setCount] = useState(initialCount);
  const [counting, startCounting] = useTransition();
  const latestRequest = useRef(0);

  function update(next: string[]) {
    setSelected(next);
    const request = ++latestRequest.current;
    startCounting(async () => {
      const total = next.length ? await estimateRecipients(next) : 0;
      // Ignore answers to requests that have since been superseded.
      if (request === latestRequest.current) setCount(total);
    });
  }

  function toggle(listId: string, checked: boolean) {
    update(checked ? [...selected, listId] : selected.filter((id) => id !== listId));
  }

  const allSelected = lists.length > 0 && selected.length === lists.length;

  return (
    <Card id="audience" className="scroll-mt-6">
      <CardHeader
        title="Audience"
        description="Choose which lists receive this campaign."
        actions={
          lists.length > 1 ? (
            <button
              type="button"
              className="shrink-0 text-sm font-medium text-indigo-600 hover:text-indigo-500"
              onClick={() => {
                update(allSelected ? [] : lists.map((l) => l.id));
                onEdit();
              }}
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {lists.length === 0 ? (
          <div className="rounded-md border-2 border-dashed border-slate-200 px-4 py-6 text-center">
            <p className="text-sm font-medium text-slate-900">You don&apos;t have any lists yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Campaigns are sent to lists.{" "}
              <Link href="/lists" className="font-medium text-indigo-600 hover:text-indigo-500">
                Create a list
              </Link>{" "}
              and add some contacts, then come back here.
            </p>
          </div>
        ) : (
          <fieldset>
            <legend className="sr-only">Lists</legend>
            <ul
              className={cn(
                "max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-md border",
                error ? "border-red-300" : "border-slate-200",
              )}
            >
              {lists.map((list) => {
                const checked = selected.includes(list.id);
                return (
                  <li key={list.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50",
                        checked && "bg-indigo-50/40",
                      )}
                    >
                      <input
                        type="checkbox"
                        name="listIds"
                        value={list.id}
                        checked={checked}
                        onChange={(e) => toggle(list.id, e.target.checked)}
                        className="h-4 w-4 shrink-0 accent-indigo-600"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{list.name}</span>
                      <span className="shrink-0 text-sm tabular-nums text-slate-500">
                        {formatNumber(list.subscribed)} subscribed
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {error ? <p className="mt-1.5 text-xs text-red-600">{error}</p> : null}
          </fieldset>
        )}

        <div className="flex items-center justify-between gap-4 rounded-md bg-slate-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-900">Recipients</p>
            <p className="text-xs text-slate-500">
              Subscribed contacts across the selected lists. People on several lists get one email; unsubscribed and
              bounced contacts are skipped.
            </p>
          </div>
          <p
            className={cn("text-2xl font-semibold tabular-nums text-slate-900 transition-opacity", counting && "opacity-50")}
            aria-live="polite"
            aria-busy={counting}
          >
            {formatNumber(count)}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
