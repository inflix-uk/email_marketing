"use client";

import { useEffect, useId, useMemo, useReducer, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  ADDABLE_BLOCK_TYPES,
  BLOCK_LABELS,
  canAddBlock,
  canMoveBlock,
  createBlock,
  dropIndex,
  editorReducer,
  newBlockId,
  renderDesign,
  serializeDesign,
  type AddableBlockType,
  type Block,
  type EditorAction,
  type EmailDesign,
} from "@/lib/email-design";
import { buildPreviewDocument } from "@/lib/templates/preview";
import { cn } from "@/lib/utils";
import { BlockFields, StylesFields } from "./block-fields";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronIcon,
  ConfirmDialog,
  DesktopIcon,
  DuplicateIcon,
  GripIcon,
  IconButton,
  MobileIcon,
  PlusIcon,
  Segmented,
  SegmentButton,
  TrashIcon,
} from "./controls";
import { ImageLibraryProvider } from "./image-picker";
import { PreviewFrame, type PreviewWidth } from "./preview-frame";
import { useDebouncedValue } from "./use-debounced-value";

export interface VisualEditorProps {
  /** Name of the hidden input carrying the generated HTML. */
  name: string;
  /** Name of the hidden input carrying the design JSON. */
  designName: string;
  /** Starting design. Later changes are ignored - remount with a `key` to reset. */
  initialDesign: EmailDesign;
  /**
   * True when the design was not loaded from saved content (a blank start):
   * the parent is then told the generated HTML + design right away. Otherwise
   * it only hears about edits.
   */
  announceInitial?: boolean;
  /** Minimum pane height in px (used when `height` isn't set). */
  minHeight?: number;
  /** CSS height of the editing / preview panes. */
  height?: string;
  onChange?: (html: string) => void;
  onDesignChange?: (design: string) => void;
  /** The user confirmed leaving the visual editor; receives the generated HTML. */
  onSwitchToHtml: (html: string) => void;
}

/** Short description of a block for the block list. */
function summarize(block: Block): string {
  const plain = (text: string) =>
    text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*\\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  switch (block.type) {
    case "heading":
    case "text":
      return plain(block.text) || "Empty";
    case "image":
      return block.alt.trim() || (block.src.trim() ? (block.src.split(/[/?#]/).filter(Boolean).pop() ?? "") : "No image yet");
    case "button":
      return block.label.trim() || "No label";
    case "divider":
      return "Line";
    case "spacer":
      return `${block.height}px`;
    case "columns": {
      const count = block.columns[0].blocks.length + block.columns[1].blocks.length;
      return `${count} ${count === 1 ? "item" : "items"}`;
    }
    case "footer":
      return "Address and unsubscribe link";
  }
}

type DragState = { id: string; overId: string | null; position: "before" | "after" };

/** Private drag type: a block dragged out of the list can't be dropped into a text field as text. */
const DRAG_TYPE = "application/x-email-block";

/**
 * Block-based email editor: the list of blocks with the selected block's
 * settings on the left, a live preview on the right. Submits the generated
 * HTML and the design JSON through hidden inputs.
 */
export function VisualEditor({
  name,
  designName,
  initialDesign,
  announceInitial = false,
  minHeight = 480,
  height,
  onChange,
  onDesignChange,
  onSwitchToHtml,
}: VisualEditorProps) {
  const uid = useId();
  const [state, dispatch] = useReducer(editorReducer, initialDesign, (design) => ({
    design,
    selectedId: design.blocks.find((block) => block.type !== "footer")?.id ?? null,
  }));
  const { design, selectedId } = state;

  const [tab, setTab] = useState<"content" | "styles">("content");
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [width, setWidth] = useState<PreviewWidth>("desktop");
  const [adding, setAdding] = useState(false);
  const [confirmingHtml, setConfirmingHtml] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);

  // What gets submitted: always in step with the design.
  const html = useMemo(() => renderDesign(design), [design]);
  const json = useMemo(() => serializeDesign(design), [design]);

  // The preview trails editing slightly so the iframe doesn't reload on every key.
  const settled = useDebouncedValue(design, 250);
  const srcDoc = useMemo(() => buildPreviewDocument(renderDesign(settled, { placeholders: true })), [settled]);

  // Tell the parent about edits (and about the starting content of a blank start).
  const reported = useRef<{ html: string; json: string } | null>(null);
  useEffect(() => {
    const last = (reported.current ??= announceInitial ? { html: "", json: "" } : { html, json });
    if (last.html !== html) {
      last.html = html;
      onChange?.(html);
    }
    if (last.json !== json) {
      last.json = json;
      onDesignChange?.(json);
    }
  }, [html, json, onChange, onDesignChange, announceInitial]);

  // Moving, adding and deleting re-order the DOM, which can drop keyboard
  // focus; put it back on the control (or block) the user was working with.
  const focusAfterRender = useRef<{ id: string; fallbackId?: string } | null>(null);
  useEffect(() => {
    const wanted = focusAfterRender.current;
    if (!wanted) return;
    focusAfterRender.current = null;
    const usable = (id?: string) => {
      const element = id ? document.getElementById(id) : null;
      return element instanceof HTMLElement && !(element as HTMLButtonElement).disabled ? element : null;
    };
    (usable(wanted.id) ?? usable(wanted.fallbackId))?.focus();
  });

  const headerId = (blockId: string) => `${uid}-block-${blockId}`;
  const panelId = (blockId: string) => `${uid}-panel-${blockId}`;
  const addButtonId = `${uid}-add`;
  const addPanelId = `${uid}-add-panel`;

  function add(type: AddableBlockType) {
    const block = createBlock(type, newBlockId(design));
    dispatch({ type: "add", block, afterId: selectedId });
    setAdding(false);
    focusAfterRender.current = { id: headerId(block.id) };
  }

  function move(id: string, direction: -1 | 1, focusId: string) {
    if (!canMoveBlock(design, id, direction)) return;
    dispatch({ type: "move", id, direction });
    focusAfterRender.current = { id: focusId, fallbackId: headerId(id) };
  }

  function duplicate(id: string) {
    const newId = newBlockId(design);
    dispatch({ type: "duplicate", id, newId });
    focusAfterRender.current = { id: headerId(newId), fallbackId: headerId(id) };
  }

  function remove(id: string) {
    const action: EditorAction = { type: "delete", id };
    const next = editorReducer(state, action);
    dispatch(action);
    focusAfterRender.current = { id: next.selectedId ? headerId(next.selectedId) : addButtonId, fallbackId: addButtonId };
  }

  function onHeaderKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      move(id, event.key === "ArrowUp" ? -1 : 1, headerId(id));
    }
  }

  // --- Drag and drop (pointer only; the buttons and Alt+arrows do the same) ---

  function onDragStart(event: DragEvent<HTMLElement>, id: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_TYPE, id);
    const row = event.currentTarget.closest("li");
    if (row) event.dataTransfer.setDragImage(row, 12, 18);
    // Deferred: changing the dragged row's DOM inside dragstart can cancel the drag.
    setTimeout(() => setDrag({ id, overId: null, position: "before" }), 0);
  }

  function onDragOver(event: DragEvent<HTMLElement>, block: Block) {
    if (!drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    // Nothing can go below the footer.
    const position = block.type === "footer" || event.clientY - rect.top < rect.height / 2 ? "before" : "after";
    if (drag.overId !== block.id || drag.position !== position) setDrag({ ...drag, overId: block.id, position });
  }

  function onDrop(event: DragEvent<HTMLElement>, overIndex: number) {
    if (!drag) return;
    event.preventDefault();
    const fromIndex = design.blocks.findIndex((block) => block.id === drag.id);
    if (fromIndex !== -1) {
      dispatch({ type: "moveTo", id: drag.id, toIndex: dropIndex(fromIndex, overIndex, drag.position) });
    }
    setDrag(null);
  }

  const paneHeight = height ?? `clamp(${minHeight}px, calc(100vh - 13rem), 56rem)`;

  return (
    <ImageLibraryProvider>
      <div
        className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200"
        // The editor sits inside the page's <form>: Enter in one of its text
        // fields must not submit (save) that form.
        onKeyDown={(event) => {
          const target = event.target;
          if (event.key === "Enter" && target instanceof HTMLInputElement && ["text", "url"].includes(target.type)) {
            event.preventDefault();
          }
        }}
      >
        {/* Narrow screens: one pane at a time. */}
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 lg:hidden">
          <Segmented label="View" className="flex w-full">
            <SegmentButton pressed={view === "edit"} onClick={() => setView("edit")} className="flex-1">
              Edit
            </SegmentButton>
            <SegmentButton pressed={view === "preview"} onClick={() => setView("preview")} className="flex-1">
              Preview
            </SegmentButton>
          </Segmented>
        </div>

        <div className="grid lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[26rem_minmax(0,1fr)]">
          {/* Blocks + settings */}
          <div
            className={cn("flex min-w-0 flex-col bg-slate-50/60", view !== "edit" && "max-lg:hidden")}
            style={{ height: paneHeight }}
          >
            <div className="border-b border-slate-200 bg-white px-3 py-2">
              <Segmented label="Panel" className="flex w-full">
                <SegmentButton pressed={tab === "content"} onClick={() => setTab("content")} className="flex-1">
                  Content
                </SegmentButton>
                <SegmentButton pressed={tab === "styles"} onClick={() => setTab("styles")} className="flex-1">
                  Styles
                </SegmentButton>
              </Segmented>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {tab === "styles" ? (
                <>
                  <StylesFields
                    idPrefix={`${uid}-styles`}
                    styles={design.styles}
                    onChange={(patch) => dispatch({ type: "styles", patch })}
                  />
                  <div className="mt-6 border-t border-slate-200 pt-3">
                    <button
                      type="button"
                      onClick={() => setConfirmingHtml(true)}
                      className="rounded text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600"
                    >
                      Edit as HTML code
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <button
                      id={addButtonId}
                      type="button"
                      aria-expanded={adding}
                      aria-controls={adding ? addPanelId : undefined}
                      disabled={!canAddBlock(design)}
                      onClick={() => setAdding((open) => !open)}
                      className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-300 ring-inset hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50"
                    >
                      <PlusIcon />
                      Add block
                    </button>
                    {adding ? (
                      <div
                        id={addPanelId}
                        role="group"
                        aria-label="Block to add"
                        className="mt-2 rounded-md bg-white p-2 ring-1 ring-slate-200"
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.stopPropagation();
                            setAdding(false);
                            focusAfterRender.current = { id: addButtonId };
                          }
                        }}
                      >
                        <div className="grid grid-cols-2 gap-1.5">
                          {ADDABLE_BLOCK_TYPES.map((type, i) => (
                            <button
                              key={type}
                              type="button"
                              // The panel opens from the keyboard or mouse; start at its first choice.
                              autoFocus={i === 0}
                              onClick={() => add(type)}
                              className="rounded px-2 py-1.5 text-left text-sm text-slate-700 ring-1 ring-slate-200 ring-inset hover:bg-indigo-50 hover:text-indigo-700 focus-visible:bg-indigo-50 focus-visible:text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-600"
                            >
                              {BLOCK_LABELS[type]}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <ol aria-label="Blocks in this email, in order" className="mt-3 space-y-1.5">
                    {design.blocks.map((block, index) => {
                      const selected = block.id === selectedId;
                      const isFooter = block.type === "footer";
                      const label = BLOCK_LABELS[block.type];
                      const position = `${index + 1} of ${design.blocks.length}`;
                      const dropHere = drag?.overId === block.id && drag.id !== block.id;
                      return (
                        <li
                          key={block.id}
                          onDragOver={(event) => onDragOver(event, block)}
                          onDrop={(event) => onDrop(event, index)}
                          className={cn(
                            "relative rounded-md bg-white",
                            selected ? "ring-2 ring-indigo-600" : "ring-1 ring-slate-200",
                            drag?.id === block.id && "opacity-50",
                          )}
                        >
                          {dropHere ? (
                            <span
                              aria-hidden
                              className={cn(
                                "pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-indigo-600",
                                drag.position === "before" ? "-top-1" : "-bottom-1",
                              )}
                            />
                          ) : null}

                          <div className="flex items-center">
                            {isFooter ? (
                              <span className="w-6 shrink-0" />
                            ) : (
                              // Pointer-only handle; keyboard users reorder with the buttons or Alt+arrows.
                              <span
                                draggable
                                onDragStart={(event) => onDragStart(event, block.id)}
                                onDragEnd={() => setDrag(null)}
                                title="Drag to reorder"
                                aria-hidden
                                className="flex h-9 w-6 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
                              >
                                <GripIcon />
                              </span>
                            )}
                            <button
                              id={headerId(block.id)}
                              type="button"
                              aria-expanded={selected}
                              aria-controls={selected ? panelId(block.id) : undefined}
                              aria-keyshortcuts={isFooter ? undefined : "Alt+ArrowUp Alt+ArrowDown"}
                              onClick={() => dispatch({ type: "select", id: selected ? null : block.id })}
                              onKeyDown={isFooter ? undefined : (event) => onHeaderKeyDown(event, block.id)}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pr-2 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600"
                            >
                              <span className="shrink-0 text-xs font-semibold text-slate-800">{label}</span>
                              <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{summarize(block)}</span>
                              <span className="sr-only">, block {position}</span>
                              <ChevronIcon open={selected} />
                            </button>
                          </div>

                          {selected ? (
                            <div
                              id={panelId(block.id)}
                              role="group"
                              aria-label={`${label} settings`}
                              className="space-y-3 border-t border-slate-200 px-2.5 pt-2 pb-3"
                            >
                              {isFooter ? null : (
                                <div role="toolbar" aria-label={`${label} block actions`} className="flex items-center gap-0.5">
                                  <IconButton
                                    id={`${uid}-up-${block.id}`}
                                    label="Move up"
                                    disabled={!canMoveBlock(design, block.id, -1)}
                                    onClick={() => move(block.id, -1, `${uid}-up-${block.id}`)}
                                  >
                                    <ArrowUpIcon />
                                  </IconButton>
                                  <IconButton
                                    id={`${uid}-down-${block.id}`}
                                    label="Move down"
                                    disabled={!canMoveBlock(design, block.id, 1)}
                                    onClick={() => move(block.id, 1, `${uid}-down-${block.id}`)}
                                  >
                                    <ArrowDownIcon />
                                  </IconButton>
                                  <IconButton label="Duplicate" disabled={!canAddBlock(design)} onClick={() => duplicate(block.id)}>
                                    <DuplicateIcon />
                                  </IconButton>
                                  <IconButton
                                    label="Delete block"
                                    className="ml-auto hover:text-red-600"
                                    onClick={() => remove(block.id)}
                                  >
                                    <TrashIcon />
                                  </IconButton>
                                </div>
                              )}
                              <BlockFields
                                idPrefix={`${uid}-f-${block.id}`}
                                block={block}
                                styles={design.styles}
                                onChange={(next) => dispatch({ type: "replace", block: next })}
                                newId={() => newBlockId(design)}
                              />
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  {design.blocks.every((block) => block.type === "footer") ? (
                    <p className="mt-3 text-xs text-slate-500">
                      Use <span className="font-medium">Add block</span> to start.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {/* Preview */}
          <section
            aria-label="Preview"
            className={cn(
              "flex min-w-0 flex-col border-slate-200 bg-slate-100 lg:border-l",
              view !== "preview" && "max-lg:hidden",
            )}
            style={{ height: paneHeight }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
              <h3 className="text-xs font-medium text-slate-500">Preview</h3>
              <Segmented label="Preview width">
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
            <div className="relative flex-1">
              <PreviewFrame
                srcDoc={srcDoc}
                width={width}
                height="fill"
                desktopMinWidth={settled.styles.contentWidth + 64}
              />
            </div>
          </section>
        </div>

        <input type="hidden" name={name} value={html} />
        <input type="hidden" name={designName} value={json} />

        <ConfirmDialog
          open={confirmingHtml}
          title="Edit as HTML code?"
          confirmLabel="Switch to HTML"
          onCancel={() => setConfirmingHtml(false)}
          onConfirm={() => {
            setConfirmingHtml(false);
            onSwitchToHtml(html);
          }}
        >
          <p>The email stays the same, but from now on it is edited as code.</p>
          <p>
            <span className="font-medium text-slate-900">This can&apos;t be undone</span> - you won&apos;t be able
            to go back to blocks.
          </p>
        </ConfirmDialog>
      </div>
    </ImageLibraryProvider>
  );
}
