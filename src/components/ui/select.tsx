"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Select2-style dropdown: a button that opens a panel with a search box and a
// filtered list. It is a drop-in replacement for <select>: same props, the
// same <option>/<optgroup> children, and a real (hidden) <select> underneath,
// so forms submit it and onChange still receives a normal change event.

interface Option {
  value: string;
  label: string;
  disabled: boolean;
  group: string | null;
}

/** Plain text of option children ("Newsletter", ["+ ", "New list"], ...). */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function collectOptions(children: ReactNode, group: string | null = null, out: Option[] = []): Option[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: unknown; disabled?: boolean; label?: string; children?: ReactNode }>(child)) return;
    if (child.type === "optgroup") {
      collectOptions(child.props.children, child.props.label ?? null, out);
    } else if (child.type === "option") {
      const label = textOf(child.props.children);
      out.push({
        value: child.props.value === undefined ? label : String(child.props.value),
        label,
        disabled: Boolean(child.props.disabled),
        group,
      });
    } else if (child.type === Fragment) {
      collectOptions(child.props.children, group, out);
    }
  });
  return out;
}

const trigger =
  "flex h-9 w-full items-center justify-between gap-2 rounded-md border-0 bg-white px-3 text-left text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

const PANEL_MAX_HEIGHT = 288;

export function Select({
  className,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  id,
  name,
  required,
  form,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: ComponentProps<"select">) {
  const options = useMemo(() => collectOptions(children), [children]);
  const controlled = value !== undefined;
  // Like a native select: without a value it shows the first option that isn't disabled.
  const [innerValue, setInnerValue] = useState(() =>
    defaultValue !== undefined ? String(defaultValue) : (options.find((o) => !o.disabled)?.value ?? ""),
  );
  const current = controlled ? String(value) : innerValue;
  const selected = options.find((o) => o.value === current);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const autoId = useId();
  const triggerId = id ?? `select-${autoId}`;
  const listId = `${triggerId}-list`;
  const nativeRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // A placeholder is an empty, disabled option ("Choose a list..."): shown, never offered.
  const placeholder = options.find((o) => o.value === "" && o.disabled);
  const choices = useMemo(() => options.filter((o) => o !== placeholder), [options, placeholder]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? choices.filter((o) => o.label.toLowerCase().includes(q)) : choices;
  }, [choices, query]);

  // Uncontrolled selects can be changed from outside (e.g. form code setting .value + a change event).
  useEffect(() => {
    const el = nativeRef.current;
    if (!el || controlled) return;
    const sync = () => setInnerValue(el.value);
    const onReset = () => setTimeout(sync);
    const formEl = el.form;
    el.addEventListener("change", sync);
    formEl?.addEventListener("reset", onReset);
    return () => {
      el.removeEventListener("change", sync);
      formEl?.removeEventListener("reset", onReset);
    };
  }, [controlled]);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const up = below < Math.min(PANEL_MAX_HEIGHT, 200) && rect.top > below;
    setPosition({ top: up ? rect.top - 4 : rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 192), up });
  }, []);

  function openPanel(initialQuery = "") {
    if (disabled) return;
    // Inside a modal <dialog> the panel must live in the dialog (top layer), not <body>.
    setPortalTarget(triggerRef.current?.closest("dialog") ?? document.body);
    place();
    setQuery(initialQuery);
    const index = choices.findIndex((o) => o.value === current);
    setActive(initialQuery ? 0 : Math.max(0, index));
    setOpen(true);
  }

  function close(focusTrigger = true) {
    setOpen(false);
    setQuery("");
    if (focusTrigger) triggerRef.current?.focus();
  }

  function pick(option: Option) {
    if (option.disabled) return;
    close();
    if (option.value === current) return;
    if (!controlled) setInnerValue(option.value);
    const el = nativeRef.current;
    if (el) {
      el.value = option.value;
      // Bubbling change event: React's onChange (and form listeners) see a normal select change.
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  // While open: follow scrolling/resizing, close on outside clicks.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", onPointer);
    searchRef.current?.focus();
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, place]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function move(delta: number) {
    if (filtered.length === 0) return;
    let next = active;
    for (let i = 0; i < filtered.length; i++) {
      next = (next + delta + filtered.length) % filtered.length;
      if (!filtered[next].disabled) break;
    }
    setActive(next);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openPanel();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Typing on the closed dropdown starts a search.
      event.preventDefault();
      openPanel(event.key);
    }
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(0, filtered.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[active];
      if (option) pick(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation(); // don't close a surrounding dialog
      close();
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  const label = selected && selected !== placeholder ? selected.label : (placeholder?.label ?? "");
  const isPlaceholder = !selected || selected === placeholder;

  return (
    <div className={cn("relative", className)}>
      {/* The real control: submitted with the form and the source of change events. */}
      <select
        ref={nativeRef}
        name={name}
        form={form}
        required={required}
        disabled={disabled}
        value={controlled ? String(value) : undefined}
        defaultValue={controlled ? undefined : defaultValue}
        onChange={onChange}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      >
        {children}
      </select>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onTriggerKeyDown}
        className={cn(trigger, "relative", open && "ring-2 ring-indigo-600")}
      >
        <span className={cn("truncate", isPlaceholder && "text-slate-400")}>{label || " "}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")}>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && position && portalTarget
        ? createPortal(
            <div
              ref={panelRef}
              style={{
                position: "fixed",
                left: position.left,
                width: position.width,
                ...(position.up ? { bottom: window.innerHeight - position.top } : { top: position.top }),
              }}
              className="z-[1000] overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-slate-200"
            >
              <div className="border-b border-slate-100 p-2">
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search..."
                  aria-label="Search options"
                  aria-controls={listId}
                  aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  className="block h-8 w-full rounded border-0 px-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600"
                />
              </div>
              <ul id={listId} role="listbox" aria-labelledby={triggerId} className="overflow-y-auto py-1" style={{ maxHeight: PANEL_MAX_HEIGHT - 48 }}>
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-slate-500">No results found</li>
                ) : (
                  filtered.map((option, index) => {
                    const showGroup = option.group && option.group !== filtered[index - 1]?.group;
                    const isSelected = option.value === current;
                    return (
                      <li key={`${option.group ?? ""}-${option.value}`} role="presentation">
                        {showGroup ? (
                          <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{option.group}</div>
                        ) : null}
                        <div
                          id={`${listId}-${index}`}
                          data-index={index}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={option.disabled || undefined}
                          onPointerEnter={() => !option.disabled && setActive(index)}
                          onClick={() => pick(option)}
                          className={cn(
                            "flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm",
                            option.disabled
                              ? "cursor-not-allowed text-slate-400"
                              : index === active
                                ? "bg-indigo-600 text-white"
                                : isSelected
                                  ? "text-indigo-700"
                                  : "text-slate-700",
                            option.group && "pl-5",
                          )}
                        >
                          <span className="truncate">{option.label}</span>
                          {isSelected ? (
                            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="h-4 w-4 shrink-0">
                              <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.58l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
                            </svg>
                          ) : null}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            portalTarget,
          )
        : null}
    </div>
  );
}

