"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import { GROUP_BYS, METRICS, RANGE_PRESETS, type DateRange, type ReportQuery } from "@/lib/reports/rollup";

/** The report settings as a plain GET form, so every view is a shareable URL. */
export function ReportControls({
  query,
  range,
  lists,
}: {
  query: ReportQuery;
  /** The dates currently shown (pre-fills the custom date fields). */
  range: DateRange;
  lists: { id: string; name: string }[];
}) {
  const [preset, setPreset] = useState<string>(query.range);

  return (
    <form method="get" action="/reports" className="flex flex-wrap items-end gap-3 print:hidden">
      <div className="w-44 space-y-1.5">
        <Label htmlFor="r-range">Dates</Label>
        <Select id="r-range" name="range" defaultValue={query.range} onChange={(e) => setPreset(e.target.value)}>
          {RANGE_PRESETS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      {preset === "custom" ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="r-from">From</Label>
            <Input id="r-from" type="date" name="from" defaultValue={range.from} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-to">To</Label>
            <Input id="r-to" type="date" name="to" defaultValue={range.to} required />
          </div>
        </>
      ) : null}
      <div className="w-36 space-y-1.5">
        <Label htmlFor="r-group">Group by</Label>
        <Select id="r-group" name="group" defaultValue={query.group}>
          {GROUP_BYS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-48 space-y-1.5">
        <Label htmlFor="r-list">List</Label>
        <Select id="r-list" name="list" defaultValue={query.listId ?? ""}>
          <option value="">All lists</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-40 space-y-1.5">
        <Label htmlFor="r-m1">Chart</Label>
        <Select id="r-m1" name="m1" defaultValue={query.metrics[0]}>
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-40 space-y-1.5">
        <Label htmlFor="r-m2">Second chart</Label>
        <Select id="r-m2" name="m2" defaultValue={query.metrics[1] ?? ""}>
          <option value="">None</option>
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>
      <label className="flex h-9 items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="compare"
          value="1"
          defaultChecked={query.compare}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
        />
        Compare with previous period
      </label>
      <Button type="submit">Show</Button>
    </form>
  );
}
