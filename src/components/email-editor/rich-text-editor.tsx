"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { richHtmlParagraphs, sanitizeLinkUrl, sanitizeRichHtml } from "@/lib/email-design";
import { escapeHtml } from "@/lib/render";
import { cn } from "@/lib/utils";

// Text editor for the visual email editor's text blocks: you type formatted
// text directly (contentEditable). Selecting text shows a small toolbar with
// Bold, Italic, Underline and Link; clicking a link lets you change or remove
// it. Whatever the browser produces is passed through sanitizeRichHtml() on
// every change, and the server sanitises again when it renders the email.

export interface RichTextEditorProps {
  id: string;
  /** id of the visible label. */
  labelId: string;
  /** Sanitised rich HTML. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Minimum height in text lines. */
  minLines?: number;
  /** Lets the parent insert text (e.g. a merge tag) at the last caret position. */
  insertRef?: RefObject<((text: string) => void) | null>;
}

type Popover =
  | { kind: "none" }
  | { kind: "toolbar"; top: number; left: number }
  | { kind: "link"; top: number; left: number; anchor: HTMLAnchorElement | null };

const EMPTY_HTML = "<p><br></p>";

function closestAnchor(node: Node | null, root: HTMLElement): HTMLAnchorElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof HTMLAnchorElement) return current;
    current = current.parentNode;
  }
  return null;
}

/** The selection's range, when it is inside `root`. */
function rangeIn(root: HTMLElement): Range | null {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? range : null;
}

function restoreRange(root: HTMLElement, range: Range | null) {
  root.focus();
  if (!range) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function RichTextEditor({ id, labelId, value, onChange, placeholder, minLines = 5, insertRef }: RichTextEditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const linkBoxRef = useRef<HTMLDivElement>(null);
  /** What we last sent up, so our own changes don't reset the DOM (and the caret). */
  const lastValue = useRef<string | null>(null);
  /** The selection when the field lost focus or the link box opened. */
  const savedRange = useRef<Range | null>(null);
  const [popover, setPopover] = useState<Popover>({ kind: "none" });
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState(false);
  const uid = useId();

  // Load the value into the editor when it changes from outside.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === lastValue.current) return;
    editor.innerHTML = value || EMPTY_HTML;
    lastValue.current = value;
  }, [value]);

  const emit = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const clean = sanitizeRichHtml(editor.innerHTML);
    if (clean === lastValue.current) return;
    lastValue.current = clean;
    onChange(clean);
  }, [onChange]);

  /** Position for a floating box just above (or below, near the top) the range. */
  const positionFor = useCallback((range: Range): { top: number; left: number } | null => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;
    const rects = range.getClientRects();
    const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
    const box = wrapper.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && rect.top === 0) return null;
    const above = rect.top - box.top - 40;
    const top = above >= 0 ? above : rect.bottom - box.top + 6;
    const left = Math.max(0, Math.min(rect.left - box.left, box.width - 240));
    return { top, left };
  }, []);

  const openLinkBox = useCallback(
    (range: Range, anchor: HTMLAnchorElement | null) => {
      const position = positionFor(range) ?? { top: 0, left: 0 };
      savedRange.current = range.cloneRange();
      setUrl(anchor?.getAttribute("href") ?? "");
      setUrlError(false);
      setPopover({ kind: "link", ...position, anchor });
    },
    [positionFor],
  );

  // Show the toolbar while text is selected in the editor.
  useEffect(() => {
    const onSelectionChange = () => {
      const editor = editorRef.current;
      if (!editor) return;
      setPopover((current) => {
        if (current.kind === "link") return current; // stays open until applied or closed
        const range = rangeIn(editor);
        if (!range || document.activeElement !== editor) return { kind: "none" };
        if (!range.collapsed) {
          const position = positionFor(range);
          return position ? { kind: "toolbar", ...position } : { kind: "none" };
        }
        return { kind: "none" };
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [positionFor]);

  // Close the link box on a click anywhere outside it (a click on another link reopens it).
  useEffect(() => {
    if (popover.kind !== "link") return;
    urlRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!linkBoxRef.current?.contains(event.target as Node)) setPopover({ kind: "none" });
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [popover.kind]);

  // Let the parent insert merge tags where the caret was.
  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      restoreRange(editor, savedRange.current);
      if (!rangeIn(editor)) {
        // Never focused: insert at the end.
        const range = document.createRange();
        range.selectNodeContents(editor.lastChild ?? editor);
        range.collapse(false);
        restoreRange(editor, range);
      }
      document.execCommand("insertText", false, text);
      emit();
    };
    return () => {
      insertRef.current = null;
    };
  }, [insertRef, emit]);

  function format(command: "bold" | "italic" | "underline") {
    document.execCommand(command);
    emit();
  }

  function startLink() {
    const editor = editorRef.current;
    if (!editor) return;
    const range = rangeIn(editor);
    if (!range) return;
    openLinkBox(range, closestAnchor(range.startContainer, editor));
  }

  function closeLinkBox() {
    const editor = editorRef.current;
    setPopover({ kind: "none" });
    if (editor) restoreRange(editor, savedRange.current);
  }

  function applyLink() {
    const editor = editorRef.current;
    if (!editor || popover.kind !== "link") return;
    const href = sanitizeLinkUrl(url);
    if (!href) {
      setUrlError(true);
      return;
    }
    const { anchor } = popover;
    setPopover({ kind: "none" });
    restoreRange(editor, savedRange.current);
    if (anchor && editor.contains(anchor)) {
      anchor.setAttribute("href", href);
    } else {
      const range = rangeIn(editor);
      if (range && !range.collapsed) {
        document.execCommand("createLink", false, href);
      } else {
        // Nothing selected: insert the address itself as the link text.
        const label = escapeHtml(url.trim());
        document.execCommand("insertHTML", false, `<a href="${escapeHtml(href)}">${label}</a>&nbsp;`);
      }
    }
    emit();
  }

  function removeLink() {
    const editor = editorRef.current;
    if (!editor || popover.kind !== "link") return;
    const { anchor } = popover;
    setPopover({ kind: "none" });
    if (anchor && editor.contains(anchor)) {
      const parent = anchor.parentNode;
      while (anchor.firstChild) parent?.insertBefore(anchor.firstChild, anchor);
      parent?.removeChild(anchor);
    }
    restoreRange(editor, null);
    emit();
  }

  function openLink() {
    const href = sanitizeLinkUrl(url);
    if (href && /^https?:/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === "k") {
      event.preventDefault();
      startLink();
    } else if (key === "b" || key === "i" || key === "u") {
      event.preventDefault();
      format(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
    }
  }

  /** A click on a link opens its box (to change or remove it). */
  function onClick() {
    const editor = editorRef.current;
    if (!editor) return;
    const range = rangeIn(editor);
    if (!range || !range.collapsed) return;
    const anchor = closestAnchor(range.startContainer, editor);
    if (anchor) {
      const linkRange = document.createRange();
      linkRange.selectNodeContents(anchor);
      openLinkBox(linkRange, anchor);
      // Keep the caret where it was clicked.
      savedRange.current = range.cloneRange();
    }
  }

  /** Paste keeps only the safe formatting (links, bold...). */
  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    event.preventDefault();
    if (html) {
      document.execCommand("insertHTML", false, richHtmlParagraphs(html).join("<br>"));
    } else if (text) {
      document.execCommand("insertText", false, text);
    }
    emit();
  }

  const empty = !value;

  return (
    <div ref={wrapperRef} className="relative">
      <div
        ref={editorRef}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelId}
        aria-describedby={`${uid}-hint`}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onPaste={onPaste}
        onFocus={() => document.execCommand("defaultParagraphSeparator", false, "p")}
        onBlur={() => {
          const editor = editorRef.current;
          const range = editor ? rangeIn(editor) : null;
          if (range) savedRange.current = range.cloneRange();
        }}
        className={cn(
          "block w-full overflow-y-auto rounded-md bg-white px-2.5 py-2 text-sm leading-5 text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-600 focus:outline-none",
          "[&_a]:text-indigo-600 [&_a]:underline [&_p]:min-h-5 [&_p+p]:mt-2",
        )}
        style={{ minHeight: `${minLines * 1.25 + 1}rem`, maxHeight: "24rem" }}
      />
      {empty && placeholder ? (
        <span aria-hidden className="pointer-events-none absolute top-2 left-2.5 text-sm text-slate-400">
          {placeholder}
        </span>
      ) : null}
      <p id={`${uid}-hint`} className="mt-1 text-xs text-slate-500">
        Select text to make it bold or add a link.
      </p>

      {popover.kind === "toolbar" ? (
        <div
          role="toolbar"
          aria-label="Text formatting"
          className="absolute z-20 flex items-center gap-0.5 rounded-md bg-slate-900 p-1 text-white shadow-lg"
          style={{ top: popover.top, left: popover.left }}
          // Keep the text selected while clicking the buttons.
          onMouseDown={(event) => event.preventDefault()}
        >
          <ToolbarButton label="Bold (Ctrl+B)" onClick={() => format("bold")}>
            <span className="font-bold">B</span>
          </ToolbarButton>
          <ToolbarButton label="Italic (Ctrl+I)" onClick={() => format("italic")}>
            <span className="font-serif italic">I</span>
          </ToolbarButton>
          <ToolbarButton label="Underline (Ctrl+U)" onClick={() => format("underline")}>
            <span className="underline">U</span>
          </ToolbarButton>
          <span className="mx-0.5 h-4 w-px bg-slate-600" aria-hidden />
          <ToolbarButton label="Link (Ctrl+K)" onClick={startLink}>
            <LinkIcon />
            <span className="ml-1">Link</span>
          </ToolbarButton>
        </div>
      ) : null}

      {popover.kind === "link" ? (
        <div
          ref={linkBoxRef}
          role="dialog"
          aria-label={popover.anchor ? "Edit link" : "Add link"}
          className="absolute z-20 w-60 space-y-2 rounded-md bg-white p-2 shadow-lg ring-1 ring-slate-200"
          style={{ top: popover.top, left: popover.left }}
        >
          <label htmlFor={`${uid}-url`} className="block text-xs font-medium text-slate-700">
            Link address
          </label>
          <input
            ref={urlRef}
            id={`${uid}-url`}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // never submit the surrounding form
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeLinkBox();
              }
            }}
            placeholder="https://example.com"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={urlError || undefined}
            aria-describedby={urlError ? `${uid}-url-error` : undefined}
            className="block w-full rounded-md border-0 bg-white px-2 py-1.5 text-xs text-slate-900 ring-1 ring-slate-300 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600 focus:ring-inset"
          />
          {urlError ? (
            <p id={`${uid}-url-error`} className="text-xs text-red-600">
              Enter a web address like example.com, an email or tel: number.
            </p>
          ) : null}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={applyLink}
              className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600"
            >
              {popover.anchor ? "Save" : "Add link"}
            </button>
            {popover.anchor ? (
              <>
                <LinkBoxButton onClick={openLink}>Open</LinkBoxButton>
                <LinkBoxButton onClick={removeLink} danger>
                  Remove
                </LinkBoxButton>
              </>
            ) : null}
            <LinkBoxButton onClick={closeLinkBox} className="ml-auto">
              Cancel
            </LinkBoxButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
    >
      {children}
    </button>
  );
}

function LinkBoxButton({
  onClick,
  danger = false,
  className,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600",
        danger ? "text-red-600" : "text-slate-700",
        className,
      )}
    >
      {children}
    </button>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5" aria-hidden>
      <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1" strokeLinecap="round" />
      <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1" strokeLinecap="round" />
    </svg>
  );
}
