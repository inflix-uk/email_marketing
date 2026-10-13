"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SAMPLE_CONTACT } from "@/lib/render";
import { formatByteSize, htmlByteSize, lintEmailHtml } from "@/lib/templates/lint";
import { buildPreviewDocument } from "@/lib/templates/preview";
import { cn } from "@/lib/utils";
import { InsertVariableMenu } from "./insert-variable-menu";
import { LintList } from "./lint-list";
import { PreviewFrame, type PreviewWidth } from "./preview-frame";
import { indentSelection, insertText, newlineWithIndent, outdentSelection, type TextEdit } from "./text-edit";
import { useDebouncedValue } from "./use-debounced-value";

export interface EmailEditorProps {
  /** Name of the hidden <input> carrying the current HTML, so the editor works inside any <form>. */
  name: string;
  /** Initial HTML. Later changes are ignored - remount with a `key` to reset. */
  defaultValue: string;
  /** Shown above the preview, for context. */
  previewText?: string;
  /** Minimum height of the code / preview panes in px. */
  minHeight?: number;
  /** Called with the new HTML after every edit. */
  onChange?: (html: string) => void;
  /** id of the code textarea, for an external <label htmlFor>. */
  id?: string;
}

type View = "code" | "preview";

const SAMPLE_NAME = [SAMPLE_CONTACT.firstName, SAMPLE_CONTACT.lastName].filter(Boolean).join(" ");

/**
 * HTML email editor: a code textarea with a live preview beside it
 * (Code / Preview tabs on narrow screens), merge-tag insertion and lint checks.
 */
export function EmailEditor({ name, defaultValue, previewText, minHeight = 480, onChange, id }: EmailEditorProps) {
  const [html, setHtml] = useState(defaultValue);
  const [view, setView] = useState<View>("code");
  const [width, setWidth] = useState<PreviewWidth>("desktop");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Escape then Tab moves focus out of the textarea (Tab alone indents).
  const escapePressed = useRef(false);

  const uid = useId();
  const codeId = id ?? `${uid}-code`;

  // Preview and checks trail typing slightly so the iframe doesn't reload on every key.
  const settledHtml = useDebouncedValue(html, 300);
  const srcDoc = useMemo(() => buildPreviewDocument(settledHtml), [settledHtml]);
  const issues = useMemo(() => lintEmailHtml(settledHtml), [settledHtml]);
  const size = useMemo(() => htmlByteSize(settledHtml), [settledHtml]);

  function updateHtml(value: string) {
    setHtml(value);
    onChange?.(value);
  }

  /** Apply an edit through the browser's editing commands so Ctrl+Z still works. */
  function applyEdit(edit: TextEdit) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(edit.from, edit.to);
    const done = edit.text
      ? document.execCommand("insertText", false, edit.text)
      : edit.from === edit.to || document.execCommand("delete");
    if (!done) {
      textarea.setRangeText(edit.text, edit.from, edit.to, "end");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
    textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  }

  function insertAtCursor(text: string) {
    const textarea = textareaRef.current;
    if (textarea) applyEdit(insertText(textarea.selectionStart, textarea.selectionEnd, text));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const { value, selectionStart: start, selectionEnd: end } = event.currentTarget;
    if (event.key === "Escape") {
      escapePressed.current = true;
      return;
    }
    const leaving = escapePressed.current;
    escapePressed.current = false;
    const modified = event.ctrlKey || event.metaKey || event.altKey;

    if (event.key === "Tab" && !modified && !leaving) {
      event.preventDefault();
      const edit = event.shiftKey ? outdentSelection(value, start, end) : indentSelection(value, start, end);
      if (edit) applyEdit(edit);
    } else if (event.key === "Enter" && !modified && !event.shiftKey && !event.nativeEvent.isComposing) {
      const edit = newlineWithIndent(value, start, end);
      if (edit.text !== "\n") {
        event.preventDefault();
        applyEdit(edit);
      }
    }
  }

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <Segmented label="View" className="lg:hidden">
          <SegmentButton pressed={view === "code"} onClick={() => setView("code")}>
            Code
          </SegmentButton>
          <SegmentButton pressed={view === "preview"} onClick={() => setView("preview")}>
            Preview
          </SegmentButton>
        </Segmented>

        <div className={cn(view === "preview" && "max-lg:hidden")}>
          <InsertVariableMenu onInsert={insertAtCursor} />
        </div>

        <Segmented label="Preview width" className={cn("ml-auto", view === "code" && "max-lg:hidden")}>
          <SegmentButton pressed={width === "desktop"} onClick={() => setWidth("desktop")}>
            <DesktopIcon />
            Desktop
          </SegmentButton>
          <SegmentButton pressed={width === "mobile"} onClick={() => setWidth("mobile")}>
            <MobileIcon />
            Mobile
          </SegmentButton>
        </Segmented>
      </div>

      <div className="grid lg:grid-cols-2">
        {/* Code */}
        <div className={cn("flex min-w-0 flex-col", view !== "code" && "max-lg:hidden")}>
          <label htmlFor={codeId} className="sr-only">
            Email HTML
          </label>
          <textarea
            ref={textareaRef}
            id={codeId}
            value={html}
            onChange={(e) => updateHtml(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            aria-describedby={`${uid}-keys`}
            placeholder="<p>Hi {{first_name | there}},</p>"
            className="block w-full flex-1 resize-y border-0 bg-white p-4 font-mono text-[13px] leading-5 text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600 focus:outline-none focus:ring-inset"
            style={{ minHeight, tabSize: 2 }}
          />
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-1.5 text-xs text-slate-500">
            <p id={`${uid}-keys`}>
              <Kbd>Tab</Kbd> indents · <Kbd>Esc</Kbd> then <Kbd>Tab</Kbd> leaves the editor
            </p>
            <span className="shrink-0 tabular-nums" title="HTML size">
              {formatByteSize(size)}
            </span>
          </div>
        </div>

        {/* Preview */}
        <section
          aria-label="Preview"
          className={cn(
            "flex min-w-0 flex-col border-slate-200 bg-slate-100 lg:border-l",
            view !== "preview" && "max-lg:hidden",
          )}
          style={{ minHeight }}
        >
          <div className="space-y-0.5 border-b border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
            <p className="truncate">
              Previewing as <span className="font-medium text-slate-700">{SAMPLE_NAME}</span> &lt;
              {SAMPLE_CONTACT.email}&gt;
            </p>
            {previewText ? (
              <p className="truncate">
                Preview text: <span className="text-slate-700">{previewText}</span>
              </p>
            ) : null}
          </div>
          <div className="relative flex-1">
            {settledHtml.trim() ? (
              <PreviewFrame srcDoc={srcDoc} width={width} height="fill" />
            ) : (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                Nothing to preview yet
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="border-t border-slate-200 px-4 py-3">
        <LintList issues={issues} />
      </div>

      <input type="hidden" name={name} value={html} />
    </div>
  );
}

function Segmented({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex rounded-md bg-slate-200/70 p-0.5", className)}>
      {children}
    </div>
  );
}

function SegmentButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600",
        pressed ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
      )}
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-slate-300 bg-white px-1 font-sans text-[11px] text-slate-600">{children}</kbd>
  );
}

function DesktopIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-3.5 w-3.5" aria-hidden>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 17h6M10 13.5V17" strokeLinecap="round" />
    </svg>
  );
}

function MobileIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-3.5 w-3.5" aria-hidden>
      <rect x="5.5" y="2.5" width="9" height="15" rx="1.5" />
      <path d="M9 15h2" strokeLinecap="round" />
    </svg>
  );
}
