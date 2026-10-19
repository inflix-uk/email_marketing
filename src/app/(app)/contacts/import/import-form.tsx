"use client";

import { startTransition, useActionState, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
import { Alert, Field, Input, Select } from "@/components/ui/form";
import { Card, CardBody } from "@/components/ui/layout";
import {
  detectColumnTarget,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseCsv,
  suggestMapping,
  type ColumnMapping,
  type ColumnTarget,
} from "@/lib/contacts/import";
import type { ListRef } from "@/lib/contacts/queries";
import { cn, formatNumber } from "@/lib/utils";
import { importContactsAction, type ImportResult } from "./actions";

/** Select value for "create a new list". */
const NEW_LIST = "__new__";

interface LoadedFile {
  name: string;
  text: string;
  headers: string[];
  rowCount: number;
}

/** Column index per field; -1 = not in the file. */
interface Columns {
  email: number;
  first: number;
  last: number;
}

type Role = keyof Columns;

const ROLE_LABELS: Record<Role, string> = { email: "Email", first: "First name", last: "Last name" };

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "customers.csv" -> "customers" */
function baseName(fileName: string): string {
  return fileName.replace(/\.(csv|txt)$/i, "").trim().slice(0, 100);
}

/** Guess the email / name columns from the headers. A single "Name" column is used as the first name (and split). */
function detectColumns(headers: string[]): Columns {
  const suggested = suggestMapping(headers);
  const find = (t: ColumnTarget) => suggested.findIndex((m) => m.target === t);
  const first = find("first_name");
  return { email: find("email"), first: first >= 0 ? first : find("full_name"), last: find("last_name") };
}

/** A full-name column ("Name") picked as first name, with no last-name column: split it into first and last. */
function splitsFullName(headers: string[], cols: Columns): boolean {
  return cols.first >= 0 && cols.last < 0 && detectColumnTarget(headers[cols.first] ?? "") === "full_name";
}

/** The mapping the server expects: one entry per column, everything else ignored. */
function buildMapping(headers: string[], cols: Columns): ColumnMapping[] {
  const split = splitsFullName(headers, cols);
  return headers.map((_, i): ColumnMapping => {
    if (i === cols.email) return { target: "email" };
    if (i === cols.first) return { target: split ? "full_name" : "first_name" };
    if (i === cols.last) return { target: "last_name" };
    return { target: "ignore" };
  });
}

/** Wraps the form so "Import another file" can start again from a clean slate. */
export function ImportFlow({ lists, defaultListId }: { lists: ListRef[]; defaultListId?: string }) {
  const [run, setRun] = useState(0);
  return <ImportForm key={run} lists={lists} defaultListId={defaultListId} onReset={() => setRun((n) => n + 1)} />;
}

function ImportForm({ lists, defaultListId, onReset }: { lists: ListRef[]; defaultListId?: string; onReset: () => void }) {
  const [state, dispatch, pending] = useActionState(importContactsAction, {});
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cols, setCols] = useState<Columns>({ email: -1, first: -1, last: -1 });
  const [editingCols, setEditingCols] = useState(false);
  const [listChoice, setListChoice] = useState(
    defaultListId ?? (lists.length === 0 ? NEW_LIST : lists.length === 1 ? lists[0].id : ""),
  );
  const [newListName, setNewListName] = useState("");

  if (state.result) return <ImportDone result={state.result} onReset={onReset} />;

  async function loadFile(selected: File | undefined) {
    setFileError(null);
    if (!selected) return;
    if (!/\.(csv|txt)$/i.test(selected.name) && selected.type !== "text/csv") {
      setFileError("Choose a .csv file. In Excel or Google Sheets, save or download the sheet as CSV.");
      return;
    }
    if (selected.size > MAX_IMPORT_BYTES) {
      setFileError(`This file is too big (${formatBytes(selected.size)}). The limit is ${formatBytes(MAX_IMPORT_BYTES)}.`);
      return;
    }
    setReading(true);
    try {
      const text = await selected.text();
      const { headers, rows } = parseCsv(text);
      if (headers.length === 0 || rows.length === 0) {
        setFileError("This file is empty. It needs a header row and at least one contact.");
      } else if (rows.length > MAX_IMPORT_ROWS) {
        setFileError(`This file has ${formatNumber(rows.length)} rows. Split it into files of at most ${formatNumber(MAX_IMPORT_ROWS)}.`);
      } else {
        const detected = detectColumns(headers);
        setFile({ name: selected.name, text, headers, rowCount: rows.length });
        setCols(detected);
        setEditingCols(detected.email < 0);
        if (listChoice === NEW_LIST && !newListName) setNewListName(baseName(selected.name));
      }
    } catch {
      setFileError("Couldn't read this file. Make sure it's a CSV file.");
    } finally {
      setReading(false);
    }
  }

  function onFileInput(e: ChangeEvent<HTMLInputElement>) {
    void loadFile(e.target.files?.[0]);
    e.target.value = "";
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    void loadFile(e.dataTransfer.files?.[0]);
  }

  /** Use `column` for `role`; a column can only be used once. */
  function setColumn(role: Role, column: number) {
    setCols((current) => {
      const next = { ...current, [role]: column };
      for (const other of Object.keys(next) as Role[]) {
        if (other !== role && column >= 0 && next[other] === column) next[other] = -1;
      }
      return next;
    });
  }

  function onListChange(value: string) {
    setListChoice(value);
    if (value === NEW_LIST && !newListName && file) setNewListName(baseName(file.name));
  }

  const creatingList = listChoice === NEW_LIST;
  const listReady = creatingList ? Boolean(newListName.trim()) : Boolean(listChoice);
  const canImport = Boolean(file) && cols.email >= 0 && listReady && !pending;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !canImport) return;
    const formData = new FormData();
    formData.set("csv", file.text);
    formData.set("mapping", JSON.stringify(buildMapping(file.headers, cols)));
    formData.set("listId", creatingList ? "" : listChoice);
    formData.set("newListName", creatingList ? newListName : "");
    startTransition(() => dispatch(formData));
  }

  const columnName = (i: number) => (i >= 0 ? file?.headers[i] : null) ?? "—";

  return (
    <Card className="max-w-2xl">
      <form onSubmit={onSubmit}>
        <CardBody className="space-y-5">
          {/* 1. File */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700">CSV file</p>
            <input id="csv-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={onFileInput} disabled={reading || pending} />
            {file ? (
              <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2 ring-1 ring-inset ring-slate-200">
                <p className="min-w-0 truncate text-sm text-slate-900">
                  <span className="font-medium">{file.name}</span>
                  <span className="text-slate-500">
                    {" "}
                    · {formatNumber(file.rowCount)} {file.rowCount === 1 ? "row" : "rows"}
                  </span>
                </p>
                <label htmlFor="csv-file" className={cn(buttonClasses("ghost", "sm"), "cursor-pointer")}>
                  Change file
                </label>
              </div>
            ) : (
              <label
                htmlFor="csv-file"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-6 text-center transition-colors",
                  dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50",
                )}
              >
                <span className="text-sm font-medium text-indigo-600">{reading ? "Reading file..." : "Choose a CSV file"}</span>
                <span className="mt-0.5 text-xs text-slate-500">or drag it here</span>
              </label>
            )}
            {fileError ? <Alert tone="error">{fileError}</Alert> : null}
          </div>

          {/* 2. Columns (only shown to correct them) */}
          {file ? (
            editingCols ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">Columns</legend>
                {cols.email < 0 ? <p className="text-sm text-amber-700">Choose the column with the email addresses.</p> : null}
                <div className="grid gap-3 sm:grid-cols-3">
                  {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                    <div key={role} className="space-y-1">
                      <label htmlFor={`col-${role}`} className="block text-xs text-slate-500">
                        {ROLE_LABELS[role]}
                      </label>
                      <Select id={`col-${role}`} value={cols[role]} onChange={(e) => setColumn(role, Number(e.target.value))}>
                        <option value={-1}>{role === "email" ? "Choose..." : "—"}</option>
                        {file.headers.map((header, i) => (
                          <option key={i} value={i}>
                            {header}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
              </fieldset>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p className="text-slate-600">
                  {splitsFullName(file.headers, cols) ? (
                    <>
                      Email: <span className="font-medium text-slate-900">{columnName(cols.email)}</span> · Name:{" "}
                      <span className="font-medium text-slate-900">{columnName(cols.first)}</span>
                    </>
                  ) : (
                    <>
                      Email: <span className="font-medium text-slate-900">{columnName(cols.email)}</span> · First name:{" "}
                      <span className="font-medium text-slate-900">{columnName(cols.first)}</span> · Last name:{" "}
                      <span className="font-medium text-slate-900">{columnName(cols.last)}</span>
                    </>
                  )}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingCols(true)}>
                  Change
                </Button>
              </div>
            )
          ) : null}

          {/* 3. List */}
          <div className="grid gap-3 sm:grid-cols-2">
            {lists.length > 0 ? (
              <Field label="Add to list" htmlFor="import-list">
                <Select id="import-list" value={listChoice} onChange={(e) => onListChange(e.target.value)}>
                  <option value="" disabled>
                    Choose a list...
                  </option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                  <option value={NEW_LIST}>+ New list</option>
                </Select>
              </Field>
            ) : null}
            {creatingList ? (
              <Field label="New list name" htmlFor="new-list-name">
                <Input
                  id="new-list-name"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="e.g. Customers"
                  maxLength={100}
                  autoFocus={lists.length > 0}
                />
              </Field>
            ) : null}
          </div>

          {state.error ? <Alert tone="error">{state.error}</Alert> : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={!canImport}>
              {pending
                ? "Importing..."
                : file
                  ? `Import ${formatNumber(file.rowCount)} ${file.rowCount === 1 ? "contact" : "contacts"}`
                  : "Import"}
            </Button>
          </div>
        </CardBody>
      </form>
    </Card>
  );
}

function ImportDone({ result, onReset }: { result: ImportResult; onReset: () => void }) {
  const parts = [`${formatNumber(result.added)} added`];
  if (result.updated > 0) parts.push(`${formatNumber(result.updated)} updated`);
  if (result.unchanged > 0) parts.push(`${formatNumber(result.unchanged)} already there`);
  if (result.skipped > 0) parts.push(`${formatNumber(result.skipped)} skipped (no valid email)`);

  return (
    <Card className="max-w-2xl">
      <CardBody className="space-y-4">
        <Alert tone="success">
          Imported into <strong>{result.list.name}</strong>: {parts.join(" · ")}.
        </Alert>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/lists/${result.list.id}`}>Open list</ButtonLink>
          <Button type="button" variant="secondary" onClick={onReset}>
            Import another file
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
