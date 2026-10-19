"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { lintEmailHtml } from "@/lib/templates/lint";
import { buildPreviewDocument } from "@/lib/templates/preview";
import { cn } from "@/lib/utils";
import { applyEditToElement } from "./apply-edit";
import { DesktopIcon, MobileIcon, Segmented, SegmentButton } from "./controls";
import { InsertVariableMenu } from "./insert-variable-menu";
import { LintList } from "./lint-list";
import { PreviewFrame, type PreviewWidth } from "./preview-frame";
import { indentSelection, insertText, newlineWithIndent, outdentSelection, type TextEdit } from "./text-edit";
import { useDebouncedValue } from "./use-debounced-value";

export interface HtmlEditorProps {
  /** Name of the hidden <input> carrying the current HTML, so the editor works inside any <form>. */
  name: string;
  /** Initial HTML. Later changes are ignored - remount with a `key` to reset. */
  defaultValue: string;
  /** Minimum height of the code / preview panes in px (used when `height` isn't set). */
  minHeight?: number;
  /** CSS height of the code / preview panes. */
  height?: string;
  /** Called with the new HTML after every edit. */
  onChange?: (html: string) => void;
  /** id of the code textarea, for an external <label htmlFor>. */
  id?: string;
}

type View = "code" | "preview";

/**
 * HTML email editor: a code textarea with a live preview beside it
 * (Code / Preview tabs on narrow screens). Problems are listed underneath
 * only when there are any.
 */
export function HtmlEditor({ name, defaultValue, minHeight = 480, height, onChange, id }: HtmlEditorProps) {
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

  const paneStyle = height ? { height } : { minHeight };

  function updateHtml(value: string) {
    setHtml(value);
    onChange?.(value);
  }

  /** Apply an edit through the browser's editing commands so Ctrl+Z still works. */
  function applyEdit(edit: TextEdit) {
    if (textareaRef.current) applyEditToElement(textareaRef.current, edit);
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
        <div
          className={cn("flex min-w-0 flex-col", view !== "code" && "max-lg:hidden")}
          style={height ? { height } : undefined}
        >
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
            className={cn(
              "block min-h-0 w-full flex-1 border-0 bg-white p-4 font-mono text-[13px] leading-5 text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600 focus:outline-none focus:ring-inset",
              height ? "resize-none" : "resize-y",
            )}
            style={height ? { tabSize: 2 } : { minHeight, tabSize: 2 }}
          />
          <p id={`${uid}-keys`} className="sr-only">
            Tab indents. Press Escape, then Tab, to leave the editor.
          </p>
        </div>

        {/* Preview */}
        <section
          aria-label="Preview"
          className={cn(
            "relative min-w-0 border-slate-200 bg-slate-100 lg:border-l",
            view !== "preview" && "max-lg:hidden",
          )}
          style={paneStyle}
        >
          {settledHtml.trim() ? (
            <PreviewFrame srcDoc={srcDoc} width={width} height="fill" />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
              Nothing to preview yet
            </p>
          )}
        </section>
      </div>

      {issues.length > 0 ? (
        <div className="border-t border-slate-200 px-4 py-3">
          <LintList issues={issues} />
        </div>
      ) : null}

      <input type="hidden" name={name} value={html} />
    </div>
  );
}
