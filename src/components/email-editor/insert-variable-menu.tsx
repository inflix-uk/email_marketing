"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { MERGE_TAGS } from "@/lib/render";
import { formatMergeTag, toCustomFieldKey } from "@/lib/templates/merge-tags";

const smallInput =
  "block w-full rounded-md border-0 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 ring-1 ring-slate-300 ring-inset placeholder:font-sans placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600 focus:ring-inset";

/** "Insert variable" button + popover: built-in merge tags, custom fields and an optional fallback. */
export function InsertVariableMenu({ onInsert }: { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState("");
  const [fallback, setFallback] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const panelId = `${uid}-panel`;
  const fieldKey = toCustomFieldKey(field);

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close({ returnFocus = false } = {}) {
    setOpen(false);
    setField("");
    setFallback("");
    if (returnFocus) buttonRef.current?.focus();
  }

  function insert(key: string) {
    onInsert(formatMergeTag(key, fallback));
    close();
  }

  function insertCustomField() {
    if (fieldKey) insert(`fields.${fieldKey}`);
  }

  // The menu lives inside the host <form>: Enter must never submit it.
  function preventSubmit(event: KeyboardEvent<HTMLInputElement>, then?: () => void) {
    if (event.key === "Enter") {
      event.preventDefault();
      then?.();
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close({ returnFocus: true });
        }
      }}
      onBlur={(event) => {
        // Close when focus moves (e.g. Tab) to something outside the menu. A null
        // relatedTarget (click on a non-focusable spot, or Safari not focusing
        // clicked buttons) is handled by the pointerdown listener instead.
        const next = event.relatedTarget as Node | null;
        if (open && next && !event.currentTarget.contains(next)) close();
      }}
    >
      <Button
        ref={buttonRef}
        type="button"
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="font-mono text-xs text-slate-500" aria-hidden>
          {"{}"}
        </span>
        Insert variable
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-slate-400" aria-hidden>
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </Button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Insert variable"
          className="absolute top-full left-0 z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-white p-2 shadow-lg ring-1 ring-slate-200"
        >
          <div className="px-2 pt-1 pb-2">
            <label htmlFor={`${uid}-fallback`} className="block text-xs font-medium text-slate-700">
              Fallback if empty <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id={`${uid}-fallback`}
              value={fallback}
              onChange={(e) => setFallback(e.target.value)}
              onKeyDown={(e) => preventSubmit(e)}
              placeholder="e.g. there"
              autoComplete="off"
              className={`mt-1 ${smallInput}`}
            />
          </div>

          <ul className="max-h-60 overflow-auto border-t border-slate-100 pt-1">
            {MERGE_TAGS.map((item, i) => (
              <li key={item.tag}>
                <button
                  ref={i === 0 ? firstItemRef : undefined}
                  type="button"
                  onClick={() => insert(item.tag)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:bg-indigo-50 focus-visible:text-indigo-700 focus-visible:outline-none"
                >
                  <span>{item.label}</span>
                  <code className="font-mono text-xs text-slate-500">{`{{${item.tag}}}`}</code>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-1 border-t border-slate-100 px-2 pt-2 pb-1">
            <label htmlFor={`${uid}-field`} className="block text-xs font-medium text-slate-700">
              Custom field
            </label>
            <div className="mt-1 flex gap-2">
              <div className="flex min-w-0 flex-1 items-center rounded-md bg-white ring-1 ring-slate-300 ring-inset focus-within:ring-2 focus-within:ring-indigo-600">
                <span className="pl-2 font-mono text-xs text-slate-400" aria-hidden>
                  fields.
                </span>
                <input
                  id={`${uid}-field`}
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                  onKeyDown={(e) => preventSubmit(e, insertCustomField)}
                  placeholder="company"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={`${uid}-field-hint`}
                  className="min-w-0 flex-1 border-0 bg-transparent py-1.5 pr-2 pl-0.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:ring-0 focus:outline-none"
                />
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={insertCustomField} disabled={!fieldKey}>
                Insert
              </Button>
            </div>
            <p id={`${uid}-field-hint`} className="mt-1 text-xs text-slate-500">
              Any column imported with your contacts, e.g. company or city.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
