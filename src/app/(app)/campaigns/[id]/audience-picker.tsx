"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { cn, formatNumber } from "@/lib/utils";
import { estimateRecipients } from "../actions";
import type { ListOption } from "../_lib/queries";

export interface SegmentOption {
  id: string;
  name: string;
  /** Subscribed contacts matching the segment right now. */
  count: number;
}

/**
 * List and segment checkboxes (submitted as `listIds` / `segmentIds`) with a
 * live distinct-recipient total.
 */
export function AudiencePicker({
  lists,
  segments,
  initialLists,
  initialSegments,
  initialCount,
  error,
  onEdit,
}: {
  lists: ListOption[];
  segments: SegmentOption[];
  initialLists: string[];
  initialSegments: string[];
  initialCount: number;
  error?: string;
  /** Called for changes that don't fire a native change event (select all / clear). */
  onEdit: () => void;
}) {
  const [selectedLists, setSelectedLists] = useState<string[]>(initialLists);
  const [selectedSegments, setSelectedSegments] = useState<string[]>(initialSegments);
  const [count, setCount] = useState(initialCount);
  const [counting, startCounting] = useTransition();
  const latestRequest = useRef(0);

  function update(nextLists: string[], nextSegments: string[]) {
    setSelectedLists(nextLists);
    setSelectedSegments(nextSegments);
    const request = ++latestRequest.current;
    startCounting(async () => {
      const total = nextLists.length + nextSegments.length ? await estimateRecipients(nextLists, nextSegments) : 0;
      // Ignore answers to requests that have since been superseded.
      if (request === latestRequest.current) setCount(total);
    });
  }

  const toggled = (ids: string[], id: string, checked: boolean) =>
    checked ? [...ids, id] : ids.filter((other) => other !== id);

  const allListsSelected = lists.length > 0 && selectedLists.length === lists.length;
  const empty = lists.length === 0 && segments.length === 0;

  return (
    <Card id="audience" className="scroll-mt-6">
      <CardHeader
        title="Audience"
        description="Choose the lists and segments that receive this campaign."
        actions={
          lists.length > 1 ? (
            <button
              type="button"
              className="shrink-0 text-sm font-medium text-indigo-600 hover:text-indigo-500"
              onClick={() => {
                update(allListsSelected ? [] : lists.map((l) => l.id), selectedSegments);
                onEdit();
              }}
            >
              {allListsSelected ? "Clear lists" : "Select all lists"}
            </button>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {empty ? (
          <div className="rounded-md border-2 border-dashed border-slate-200 px-4 py-6 text-center">
            <p className="text-sm font-medium text-slate-900">You don&apos;t have any lists yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Campaigns are sent to lists or segments.{" "}
              <Link href="/lists" className="font-medium text-indigo-600 hover:text-indigo-500">
                Create a list
              </Link>{" "}
              and add some contacts, then come back here.
            </p>
          </div>
        ) : (
          <>
            {lists.length ? (
              <OptionGroup
                legend="Lists"
                name="listIds"
                unit="subscribed"
                options={lists.map((l) => ({ id: l.id, name: l.name, count: l.subscribed }))}
                selected={selectedLists}
                invalid={Boolean(error)}
                onToggle={(id, checked) => update(toggled(selectedLists, id, checked), selectedSegments)}
              />
            ) : null}
            {segments.length ? (
              <OptionGroup
                legend="Segments"
                name="segmentIds"
                unit="matching"
                options={segments}
                selected={selectedSegments}
                invalid={Boolean(error)}
                onToggle={(id, checked) => update(selectedLists, toggled(selectedSegments, id, checked))}
              />
            ) : (
              <p className="text-xs text-slate-500">
                Want to target by tag, sign-up date or activity?{" "}
                <Link href="/segments" className="font-medium text-indigo-600 hover:text-indigo-500">
                  Create a segment
                </Link>
                .
              </p>
            )}
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
          </>
        )}

        <div className="flex items-center justify-between gap-4 rounded-md bg-slate-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-900">Recipients</p>
            <p className="text-xs text-slate-500">
              Subscribed contacts in any selected list or segment. Nobody gets the email twice; unsubscribed and bounced
              contacts are skipped.
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

function OptionGroup({
  legend,
  name,
  unit,
  options,
  selected,
  invalid,
  onToggle,
}: {
  legend: string;
  name: string;
  /** Word after the count, e.g. "subscribed". */
  unit: string;
  options: { id: string; name: string; count: number }[];
  selected: string[];
  invalid: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{legend}</legend>
      <ul
        className={cn(
          "max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border",
          invalid ? "border-red-300" : "border-slate-200",
        )}
      >
        {options.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <li key={option.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50",
                  checked && "bg-indigo-50/40",
                )}
              >
                <input
                  type="checkbox"
                  name={name}
                  value={option.id}
                  checked={checked}
                  onChange={(e) => onToggle(option.id, e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-indigo-600"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{option.name}</span>
                <span className="shrink-0 text-sm tabular-nums text-slate-500">
                  {formatNumber(option.count)} {unit}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
