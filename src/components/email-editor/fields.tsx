"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ALIGNMENTS, normalizeHexColor, sanitizeLinkUrl, type Align } from "@/lib/email-design";
import { cn } from "@/lib/utils";
import { applyEditToElement } from "./apply-edit";
import { Segmented, SegmentButton } from "./controls";
import { InsertVariableMenu } from "./insert-variable-menu";
import { insertLink, insertText, toggleWrap, type TextEdit } from "./text-edit";

// Form controls for the visual editor's side panel. All of them are
// controlled by the design state, so nothing typed is lost on re-render.

const control =
  "block w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600";

const labelClass = "block text-xs font-medium text-slate-700";

export function FieldRow({
  label,
  htmlFor,
  action,
  hint,
  warning,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  /** Shown at the end of the label line (e.g. the "insert variable" button). */
  action?: ReactNode;
  hint?: ReactNode;
  warning?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex min-h-6 items-center justify-between gap-2">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={labelClass}>
            {label}
          </label>
        ) : (
          <span className={labelClass}>{label}</span>
        )}
        {action}
      </div>
      {children}
      {warning ? (
        <p className="text-xs text-amber-700" role="status">
          {warning}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

type TextElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * Remembers where the caret was when the field lost focus, so toolbar
 * buttons and the variable menu (which take focus) insert at the right place.
 */
function useCaret<T extends TextElement>() {
  const ref = useRef<T>(null);
  const caret = useRef<{ start: number; end: number } | null>(null);

  const remember = () => {
    const element = ref.current;
    if (element) caret.current = { start: element.selectionStart ?? 0, end: element.selectionEnd ?? 0 };
  };

  /** Run an edit against the current (or last known) selection. A never-focused field edits at its end. */
  const edit = (make: (value: string, start: number, end: number) => TextEdit) => {
    const element = ref.current;
    if (!element) return;
    const focused = document.activeElement === element;
    const length = element.value.length;
    const start = focused ? (element.selectionStart ?? length) : (caret.current?.start ?? length);
    const end = focused ? (element.selectionEnd ?? length) : (caret.current?.end ?? length);
    applyEditToElement(element, make(element.value, Math.min(start, length), Math.min(end, length)));
  };

  return { ref, remember, edit };
}

/** Single-line text with an "insert variable" button. */
export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  maxLength = 500,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  maxLength?: number;
}) {
  const { ref, remember, edit } = useCaret<HTMLInputElement>();
  return (
    <FieldRow
      label={label}
      htmlFor={id}
      hint={hint}
      action={<InsertVariableMenu compact onInsert={(tag) => edit((_value, start, end) => insertText(start, end, tag))} />}
    >
      <input
        ref={ref}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={remember}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        className={control}
      />
    </FieldRow>
  );
}

/** Link target. Warns when the address would be left out of the email. */
export function UrlField({
  id,
  label,
  value,
  onChange,
  placeholder = "https://example.com",
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
}) {
  const unusable = value.trim() !== "" && sanitizeLinkUrl(value) === "";
  return (
    <FieldRow
      label={label}
      htmlFor={id}
      hint={hint}
      warning={
        unusable ? "Links must start with https://, http:// or mailto: - this one will be left out." : undefined
      }
    >
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={2000}
        inputMode="url"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-invalid={unusable || undefined}
        className={control}
      />
    </FieldRow>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600"
    >
      {children}
    </button>
  );
}

/** Multi-line "simple rich text": bold, italic, links, line breaks and variables. */
export function RichTextField({
  id,
  label,
  value,
  onChange,
  rows = 6,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const { ref, remember, edit } = useCaret<HTMLTextAreaElement>();
  const bold = () => edit((v, start, end) => toggleWrap(v, start, end, "**", "bold text"));
  const italic = () => edit((v, start, end) => toggleWrap(v, start, end, "*", "italic text"));
  const link = () => edit((v, start, end) => insertLink(v, start, end));

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const action = { b: bold, i: italic, k: link }[event.key.toLowerCase()];
    if (action) {
      event.preventDefault();
      action();
    }
  }

  return (
    <FieldRow
      label={label}
      htmlFor={id}
      hint={
        <>
          <code className="font-mono">**bold**</code>, <code className="font-mono">*italic*</code>,{" "}
          <code className="font-mono">[link text](https://example.com)</code>. Leave a blank line to start a new
          paragraph.
        </>
      }
    >
      <div className="rounded-md bg-white shadow-sm ring-1 ring-slate-300 ring-inset focus-within:ring-2 focus-within:ring-indigo-600">
        <div
          role="toolbar"
          aria-label={`${label} formatting`}
          className="flex items-center gap-0.5 border-b border-slate-200 px-1.5 py-1"
        >
          <ToolButton label="Bold (Ctrl+B)" onClick={bold}>
            <span className="font-bold">B</span>
          </ToolButton>
          <ToolButton label="Italic (Ctrl+I)" onClick={italic}>
            <span className="font-serif italic">I</span>
          </ToolButton>
          <ToolButton label="Link (Ctrl+K)" onClick={link}>
            <span className="underline">Link</span>
          </ToolButton>
          <div className="ml-auto">
            <InsertVariableMenu compact onInsert={(tag) => edit((_value, start, end) => insertText(start, end, tag))} />
          </div>
        </div>
        <textarea
          ref={ref}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={remember}
          onKeyDown={onKeyDown}
          rows={rows}
          maxLength={20000}
          placeholder={placeholder}
          className="block w-full resize-y rounded-b-md border-0 bg-transparent px-2.5 py-2 text-sm leading-5 text-slate-900 placeholder:text-slate-400 focus:ring-0 focus:outline-none"
        />
      </div>
    </FieldRow>
  );
}

/**
 * Colour picker + hex field. The design only ever receives complete, valid
 * colours; while a hex code is being typed the draft stays local.
 * With `fallback`, the colour is optional: null means "use the fallback".
 */
export function ColorField({
  id,
  label,
  value,
  onChange,
  fallback,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  /** Colour used (and shown) while `value` is null, with the button that goes back to it. */
  fallback?: { color: string; label: string; onReset: () => void };
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value ?? fallback?.color ?? "#000000";
  const invalid = draft !== null && normalizeHexColor(draft) === null;

  return (
    <FieldRow
      label={label}
      htmlFor={id}
      warning={invalid ? "Use a hex colour such as #4f46e5." : undefined}
      action={
        fallback && value !== null ? (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              fallback.onReset();
            }}
            className="rounded text-xs font-medium text-indigo-600 hover:text-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600"
          >
            {fallback.label}
          </button>
        ) : fallback ? (
          <span className="text-xs text-slate-400">Default</span>
        ) : undefined
      }
    >
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: pick a colour`}
          value={shown}
          onChange={(e) => {
            setDraft(null);
            onChange(e.target.value.toLowerCase());
          }}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border-0 bg-white p-0.5 shadow-sm ring-1 ring-slate-300 ring-inset focus-visible:ring-2 focus-visible:ring-indigo-600"
        />
        <input
          id={id}
          value={draft ?? shown}
          onChange={(e) => {
            setDraft(e.target.value);
            const color = normalizeHexColor(e.target.value);
            if (color) onChange(color);
          }}
          onBlur={() => setDraft(null)}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-invalid={invalid || undefined}
          className={cn(control, "font-mono")}
        />
      </div>
    </FieldRow>
  );
}

export function RangeField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  return (
    <FieldRow
      label={label}
      htmlFor={id}
      action={
        <output htmlFor={id} className="text-xs text-slate-500 tabular-nums">
          {value}
          {unit}
        </output>
      }
    >
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${value}${unit}`}
        className="block h-6 w-full cursor-pointer accent-indigo-600"
      />
    </FieldRow>
  );
}

export function SelectField<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <FieldRow label={label} htmlFor={id}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={cn(control, "pr-8")}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

/** A small set of mutually exclusive choices, as toggle buttons. */
export function ChoiceField<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <FieldRow label={label}>
      <Segmented label={label} className="flex w-full">
        {options.map((option) => (
          <SegmentButton
            key={option.value}
            pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className="flex-1"
          >
            {option.label}
          </SegmentButton>
        ))}
      </Segmented>
    </FieldRow>
  );
}

const ALIGN_LABELS: Record<Align, string> = { left: "Left", center: "Centre", right: "Right" };

export function AlignField({ value, onChange }: { value: Align; onChange: (value: Align) => void }) {
  return (
    <ChoiceField
      label="Alignment"
      value={value}
      onChange={onChange}
      options={ALIGNMENTS.map((align) => ({ value: align, label: ALIGN_LABELS[align] }))}
    />
  );
}
