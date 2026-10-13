"use client";

import { startTransition, useActionState, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Input, Select } from "@/components/ui/form";
import { Card, CardBody, CardHeader, Stat, Table, TBody, Td, Th } from "@/components/ui/layout";
import {
  COLUMN_TARGET_LABELS,
  COLUMN_TARGETS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseCsv,
  suggestMapping,
  validateMapping,
  type ColumnMapping,
  type ColumnTarget,
} from "@/lib/contacts/import";
import type { ListRef } from "@/lib/contacts/queries";
import { slugifyFieldKey } from "@/lib/contacts/validation";
import { cn, formatNumber } from "@/lib/utils";
import { importContactsAction, type ImportSummary } from "./actions";

const PREVIEW_ROWS = 5;
/** Targets that only one column may use. */
const SINGLE_TARGETS: ColumnTarget[] = ["email", "first_name", "last_name", "full_name"];

type ListMode = "none" | "existing" | "new";

interface LoadedFile {
  name: string;
  size: number;
  text: string;
  headers: string[];
  preview: string[][];
  rowCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Wraps the wizard so "Import another file" can start again from a clean slate. */
export function ImportFlow({ lists, defaultListId }: { lists: ListRef[]; defaultListId?: string }) {
  const [run, setRun] = useState(0);
  return <ImportWizard key={run} lists={lists} defaultListId={defaultListId} onReset={() => setRun((n) => n + 1)} />;
}

function ImportWizard({
  lists,
  defaultListId,
  onReset,
}: {
  lists: ListRef[];
  defaultListId?: string;
  onReset: () => void;
}) {
  const [state, dispatch, pending] = useActionState(importContactsAction, {});
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [listMode, setListMode] = useState<ListMode>(defaultListId ? "existing" : "none");
  const [listId, setListId] = useState(defaultListId ?? lists[0]?.id ?? "");
  const [newListName, setNewListName] = useState("");
  const [updateExisting, setUpdateExisting] = useState(true);
  const [tags, setTags] = useState("");

  if (state.result) return <ImportResult result={state.result} onReset={onReset} />;

  async function loadFile(selected: File | undefined) {
    setFileError(null);
    if (!selected) return;
    if (!/\.(csv|txt)$/i.test(selected.name) && selected.type !== "text/csv") {
      setFileError("Choose a .csv file. In Excel or Google Sheets use File > Download / Save as > CSV.");
      return;
    }
    if (selected.size > MAX_IMPORT_BYTES) {
      setFileError(`This file is ${formatBytes(selected.size)} - the limit is ${formatBytes(MAX_IMPORT_BYTES)}. Split it into smaller files.`);
      return;
    }
    setReading(true);
    try {
      const text = await selected.text();
      const { headers, rows } = parseCsv(text);
      if (headers.length === 0 || rows.length === 0) {
        setFileError("This file looks empty. It needs a header row followed by at least one contact.");
      } else if (rows.length > MAX_IMPORT_ROWS) {
        setFileError(
          `This file has ${formatNumber(rows.length)} rows - split it into files of at most ${formatNumber(MAX_IMPORT_ROWS)}.`,
        );
      } else {
        setFile({ name: selected.name, size: selected.size, text, headers, preview: rows.slice(0, PREVIEW_ROWS), rowCount: rows.length });
        setMapping(suggestMapping(headers));
      }
    } catch {
      setFileError("Couldn't read this file. Make sure it's a plain-text CSV file.");
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

  function setTarget(column: number, target: ColumnTarget) {
    setMapping((current) =>
      current.map((m, i) => {
        if (i === column) {
          return target === "field"
            ? { target, fieldKey: m.fieldKey || slugifyFieldKey(file?.headers[i] ?? "") }
            : { target, fieldKey: m.fieldKey };
        }
        // Email / names can only come from one column: the previous one steps aside.
        if (SINGLE_TARGETS.includes(target) && m.target === target) return { ...m, target: "ignore" };
        return m;
      }),
    );
  }

  function setFieldKey(column: number, fieldKey: string) {
    setMapping((current) => current.map((m, i) => (i === column ? { ...m, fieldKey } : m)));
  }

  const mappingError = file ? validateMapping(mapping, file.headers.length) : null;
  const listError =
    listMode === "existing" && !listId
      ? "Choose a list."
      : listMode === "new" && !newListName.trim()
        ? "Give the new list a name."
        : null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || mappingError || listError) return;
    const formData = new FormData();
    formData.set("csv", file.text);
    formData.set("mapping", JSON.stringify(mapping));
    formData.set("listMode", listMode);
    formData.set("listId", listId);
    formData.set("newListName", newListName);
    if (updateExisting) formData.set("updateExisting", "on");
    formData.set("tags", tags);
    startTransition(() => dispatch(formData));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader title="1. Choose a CSV file" description="The first row must contain column names, e.g. Email, First name, Company, Tags." />
        <CardBody>
          {file ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
                <p className="text-sm text-slate-500">
                  {formatNumber(file.rowCount)} {file.rowCount === 1 ? "row" : "rows"} · {file.headers.length}{" "}
                  {file.headers.length === 1 ? "column" : "columns"} · {formatBytes(file.size)}
                </p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setFile(null)} disabled={pending}>
                Choose another file
              </Button>
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
                "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
                dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50",
              )}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-8 w-8 text-slate-400" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
              </svg>
              <span className="mt-2 text-sm font-medium text-indigo-600">{reading ? "Reading file..." : "Choose a CSV file"}</span>
              <span className="mt-1 text-xs text-slate-500">
                or drag it here · up to {formatBytes(MAX_IMPORT_BYTES)} / {formatNumber(MAX_IMPORT_ROWS)} rows
              </span>
              <input id="csv-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={onFileInput} disabled={reading} />
            </label>
          )}
          {fileError ? (
            <Alert tone="error" className="mt-4">
              {fileError}
            </Alert>
          ) : null}
        </CardBody>
      </Card>

      {file ? (
        <>
          <Card>
            <CardHeader
              title="2. Match your columns"
              description="We guessed what each column contains from its name - check and adjust. A Tags column can hold several tags separated by commas or semicolons."
            />
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Column in your file</Th>
                  <Th className="hidden md:table-cell">Example</Th>
                  <Th>Import as</Th>
                  <Th>Field name</Th>
                </tr>
              </thead>
              <TBody>
                {file.headers.map((header, i) => {
                  const m = mapping[i] ?? { target: "ignore" };
                  const example = file.preview.map((row) => row[i]?.trim()).find(Boolean);
                  return (
                    <tr key={i} className={m.target === "ignore" ? "bg-slate-50/60" : undefined}>
                      <Td className="font-medium text-slate-900">{header}</Td>
                      <Td className="hidden max-w-[14rem] truncate text-slate-500 md:table-cell">
                        {example ?? <span className="italic text-slate-400">empty</span>}
                      </Td>
                      <Td>
                        <label htmlFor={`target-${i}`} className="sr-only">
                          Import {header} as
                        </label>
                        <Select
                          id={`target-${i}`}
                          value={m.target}
                          onChange={(e) => setTarget(i, e.target.value as ColumnTarget)}
                          className="min-w-[11rem]"
                        >
                          {COLUMN_TARGETS.map((t) => (
                            <option key={t} value={t}>
                              {t === "full_name" ? "Full name (split)" : COLUMN_TARGET_LABELS[t]}
                            </option>
                          ))}
                        </Select>
                      </Td>
                      <Td>
                        {m.target === "field" ? (
                          <>
                            <label htmlFor={`field-${i}`} className="sr-only">
                              Custom field name for {header}
                            </label>
                            <Input
                              id={`field-${i}`}
                              value={m.fieldKey ?? ""}
                              onChange={(e) => setFieldKey(i, e.target.value)}
                              className="min-w-[10rem] font-mono"
                              autoComplete="off"
                            />
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </TBody>
            </Table>
            {mappingError ? (
              <CardBody className="border-t border-slate-200">
                <Alert tone="warning">{mappingError}</Alert>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Preview"
              description={`The first ${Math.min(PREVIEW_ROWS, file.rowCount)} of ${formatNumber(file.rowCount)} rows, as they will be imported.`}
            />
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  {file.headers.map((header, i) => {
                    const m = mapping[i];
                    const ignored = !m || m.target === "ignore";
                    return (
                      <Th key={i} className={cn("whitespace-nowrap normal-case tracking-normal", ignored && "opacity-50")}>
                        <span className="block text-slate-700">{header}</span>
                        <span className="block font-normal text-indigo-600">
                          {ignored ? "not imported" : m.target === "field" ? `{{${m.fieldKey || "?"}}}` : COLUMN_TARGET_LABELS[m.target]}
                        </span>
                      </Th>
                    );
                  })}
                </tr>
              </thead>
              <TBody>
                {file.preview.map((row, r) => (
                  <tr key={r}>
                    {file.headers.map((_, i) => (
                      <Td
                        key={i}
                        className={cn("max-w-[16rem] truncate whitespace-nowrap", mapping[i]?.target === "ignore" && "opacity-40")}
                      >
                        {row[i]}
                      </Td>
                    ))}
                  </tr>
                ))}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader title="3. Options" />
            <CardBody className="space-y-6">
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-slate-700">Add the imported contacts to a list</legend>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="listMode"
                    checked={listMode === "none"}
                    onChange={() => setListMode("none")}
                    className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-600"
                  />
                  Don&apos;t add to a list
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="flex shrink-0 items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="listMode"
                      checked={listMode === "existing"}
                      onChange={() => setListMode("existing")}
                      disabled={lists.length === 0}
                      className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-600"
                    />
                    Existing list
                  </label>
                  {lists.length > 0 ? (
                    <>
                      <label htmlFor="import-list" className="sr-only">
                        List
                      </label>
                      <Select
                        id="import-list"
                        value={listId}
                        onChange={(e) => {
                          setListId(e.target.value);
                          setListMode("existing");
                        }}
                        className="sm:max-w-xs"
                      >
                        {lists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </Select>
                    </>
                  ) : (
                    <span className="text-sm text-slate-400">(you don&apos;t have any lists yet)</span>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="flex shrink-0 items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="listMode"
                      checked={listMode === "new"}
                      onChange={() => setListMode("new")}
                      className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-600"
                    />
                    New list
                  </label>
                  <label htmlFor="new-list-name" className="sr-only">
                    New list name
                  </label>
                  <Input
                    id="new-list-name"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    onFocus={() => setListMode("new")}
                    placeholder="e.g. Newsletter subscribers"
                    maxLength={100}
                    className="sm:max-w-xs"
                  />
                </div>
              </fieldset>

              <div className="space-y-1.5">
                <label htmlFor="import-tags" className="block text-sm font-medium text-slate-700">
                  Add this tag to every imported contact
                </label>
                <Input
                  id="import-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="Optional, e.g. webinar-2026"
                  maxLength={200}
                  autoComplete="off"
                  className="sm:max-w-xs"
                />
                <p className="text-xs text-slate-500">
                  Tags are added to new and existing contacts. An import never removes a tag.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <input
                  id="update-existing"
                  type="checkbox"
                  checked={updateExisting}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                  aria-describedby="update-existing-hint"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                />
                <div>
                  <label htmlFor="update-existing" className="text-sm font-medium text-slate-700">
                    Update names and custom fields of contacts that already exist
                  </label>
                  <p id="update-existing-hint" className="mt-0.5 text-xs text-slate-500">
                    Empty cells never erase existing data. An import never changes anyone&apos;s subscription status -
                    unsubscribed and suppressed contacts stay unsubscribed.
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>

          {state.error ? <Alert tone="error">{state.error}</Alert> : null}
          {listError ? <Alert tone="warning">{listError}</Alert> : null}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {pending ? <p className="text-sm text-slate-500">Importing - large files can take a few seconds...</p> : null}
            <ButtonLink href="/contacts" variant="secondary">
              Cancel
            </ButtonLink>
            <Button type="submit" disabled={pending || Boolean(mappingError || listError)}>
              {pending ? "Importing..." : `Import ${formatNumber(file.rowCount)} ${file.rowCount === 1 ? "row" : "rows"}`}
            </Button>
          </div>
        </>
      ) : null}
    </form>
  );
}

function ImportResult({ result, onReset }: { result: ImportSummary; onReset: () => void }) {
  const unchanged = result.existing - result.updated;
  const contactsHref = result.list ? `/contacts?list=${result.list.id}` : "/contacts";

  return (
    <div className="space-y-6">
      <Alert tone="success">
        Import finished: {formatNumber(result.totalRows)} {result.totalRows === 1 ? "row" : "rows"} processed
        {result.list ? (
          <>
            {" "}
            into the list <strong>{result.list.name}</strong>
            {result.list.created ? " (new)" : ""}
          </>
        ) : null}
        .
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="New contacts" value={formatNumber(result.created)} hint="Created as subscribed" />
        {result.updateExisting ? (
          <>
            <Stat label="Updated" value={formatNumber(result.updated)} hint="Existing contacts with new details" />
            <Stat label="Unchanged" value={formatNumber(unchanged)} hint="Already existed, nothing new" />
          </>
        ) : (
          <Stat label="Already existed" value={formatNumber(result.existing)} hint="Left as they were" />
        )}
        {result.list ? (
          <Stat label={`Added to ${result.list.name}`} value={formatNumber(result.addedToList)} hint="Others were already members" />
        ) : null}
        {result.usedTags ? (
          <Stat
            label="Existing contacts tagged"
            value={formatNumber(result.tagged)}
            hint={result.tags.length > 0 ? `New contacts get ${result.tags.join(", ")} too` : "Received a new tag"}
          />
        ) : null}
        <Stat label="Invalid rows" value={formatNumber(result.invalidCount)} hint="Skipped - no valid email" />
        <Stat label="Duplicates merged" value={formatNumber(result.duplicateCount)} hint="Same email repeated in the file" />
      </div>

      {result.notSubscribed > 0 ? (
        <Alert tone="info">
          {formatNumber(result.notSubscribed)} existing {result.notSubscribed === 1 ? "contact is" : "contacts are"}{" "}
          pending, unsubscribed, bounced or marked as spam. {result.notSubscribed === 1 ? "It was" : "They were"} left that way and
          won&apos;t receive campaigns.
        </Alert>
      ) : null}

      {result.invalid.length > 0 ? (
        <Card>
          <CardHeader
            title="Skipped rows"
            description={
              result.invalidCount > result.invalid.length
                ? `Showing the first ${result.invalid.length} of ${formatNumber(result.invalidCount)}. Fix them in your file and import it again.`
                : "Fix them in your file and import it again - existing contacts won't be duplicated."
            }
          />
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Row</Th>
                <Th>Email value</Th>
                <Th>Problem</Th>
              </tr>
            </thead>
            <TBody>
              {result.invalid.map((row) => (
                <tr key={row.row}>
                  <Td className="tabular-nums text-slate-500">{row.row}</Td>
                  <Td className="max-w-xs truncate font-mono text-xs">
                    {row.value || <span className="font-sans italic text-slate-400">empty</span>}
                  </Td>
                  <Td>{row.reason}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <ButtonLink href={contactsHref}>View contacts</ButtonLink>
        {result.list ? (
          <ButtonLink href={`/lists/${result.list.id}`} variant="secondary">
            Open list
          </ButtonLink>
        ) : null}
        <Button type="button" variant="secondary" onClick={onReset}>
          Import another file
        </Button>
      </div>
    </div>
  );
}
