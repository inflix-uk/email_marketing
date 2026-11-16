"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ALIGNMENTS, normalizeHexColor, sanitizeImageUrl, sanitizeLinkUrl, type Align } from "@/lib/email-design";
import { escapeHtml } from "@/lib/render";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { applyEditToElement } from "./apply-edit";
import { Segmented, SegmentButton } from "./controls";
import { InsertVariableMenu } from "./insert-variable-menu";
import { ImagePicker } from "./image-picker";
import { RichTextEditor, type InsertAtCaret } from "./rich-text-editor";
import { insertText, type TextEdit } from "./text-edit";

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
        unusable ? "Use a full link starting with https://" : undefined
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

/**
 * Formatted text, edited in place: select text for Bold / Italic /
 * Underline / Link; the value is the sanitised rich HTML (rich-html.ts).
 */
export function RichTextField({
  id,
  label,
  value,
  onChange,
  rows = 6,
  placeholder,
  images = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  /** Show an "Image" button that puts an uploaded image at the caret. */
  images?: boolean;
}) {
  const insertRef = useRef<InsertAtCaret | null>(null);
  const labelId = `${id}-label`;
  return (
    <div className="space-y-1">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span id={labelId} className={labelClass}>
          {label}
        </span>
        <span className="flex items-center gap-1">
          {images ? <InsertImageButton onInsert={(html) => insertRef.current?.(html, { html: true })} /> : null}
          <InsertVariableMenu compact onInsert={(tag) => insertRef.current?.(tag)} />
        </span>
      </div>
      <RichTextEditor
        id={id}
        labelId={labelId}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        minLines={rows}
        insertRef={insertRef}
      />
    </div>
  );
}

/** Widest image put into a text block (px); the renderer caps it to the column again. */
const MAX_INLINE_IMAGE_WIDTH = 600;

/** The image's own width (capped), or 0 when it can't be loaded. */
function naturalWidth(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(Math.min(img.naturalWidth || 0, MAX_INLINE_IMAGE_WIDTH));
    img.onerror = () => resolve(0);
    img.src = url;
  });
}

/** "Image" beside a text field's label: upload or pick an image (or paste its address) and put it at the caret. */
function InsertImageButton({ onInsert }: { onInsert: (html: string) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState(false);
  const [busy, setBusy] = useState(false);
  const uid = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    setOpen(false);
    setAddress("");
    setAddressError(false);
  }

  async function insert(url: string, alt: string) {
    setBusy(true);
    const width = await naturalWidth(url);
    setBusy(false);
    // Close the modal right away: while it is open the text behind it can't take focus.
    dialogRef.current?.close();
    close();
    const widthAttr = width > 0 ? ` width="${width}"` : "";
    onInsert(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${widthAttr}>`);
  }

  function insertAddress() {
    const url = sanitizeImageUrl(address);
    if (!url) {
      setAddressError(true);
      return;
    }
    void insert(url, "");
  }

  return (
    <>
      <button
        type="button"
        title="Add an image here"
        onClick={() => setOpen(true)}
        className="inline-flex h-6 items-center rounded px-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600"
      >
        Image
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${uid}-title`}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-0 shadow-xl ring-1 ring-slate-200 backdrop:bg-slate-900/40"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        {open ? (
          <div className="space-y-4 p-5">
            <div>
              <h2 id={`${uid}-title`} className="text-base font-semibold text-slate-900">
                Add an image
              </h2>
              <p className="mt-1 text-xs text-slate-500">It goes where the cursor was in the text.</p>
            </div>
            <ImagePicker value="" onPick={(url) => (url ? void insert(url, "") : undefined)} />
            <div className="space-y-1">
              <label htmlFor={`${uid}-url`} className={labelClass}>
                Or the image&apos;s web address
              </label>
              <div className="flex gap-2">
                <input
                  id={`${uid}-url`}
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setAddressError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault(); // never submit the surrounding form
                      insertAddress();
                    }
                  }}
                  placeholder="https://example.com/photo.jpg"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={addressError || undefined}
                  className={control}
                />
                <button
                  type="button"
                  onClick={insertAddress}
                  className="shrink-0 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600"
                >
                  Add
                </button>
              </div>
              {addressError ? <p className="text-xs text-red-600">Enter a full address starting with https://</p> : null}
            </div>
            <div className="flex items-center justify-end gap-2">
              {busy ? <span className="text-xs text-slate-500">Adding...</span> : null}
              <button
                type="button"
                onClick={close}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
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
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
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
