"use client";

import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Small controls shared by the HTML and visual editors.

export function Segmented({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex rounded-md bg-slate-200/70 p-0.5", className)}>
      {children}
    </div>
  );
}

export function SegmentButton({
  pressed,
  className,
  ...props
}: Omit<ComponentProps<"button">, "type"> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50",
        pressed ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
        className,
      )}
      {...props}
    />
  );
}

/** Square icon-only button. `label` is its accessible name and tooltip. */
export function IconButton({
  label,
  className,
  children,
  ...props
}: Omit<ComponentProps<"button">, "type" | "aria-label" | "title"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 disabled:pointer-events-none disabled:opacity-35",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** Modal yes/no question. Safe inside a host <form>: its buttons never submit. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "primary",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-0 shadow-xl ring-1 ring-slate-200 backdrop:bg-slate-900/40"
      // Escape and backdrop clicks cancel.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="p-6">
        <h2 id={titleId} className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        <div className="mt-2 space-y-2 text-sm text-slate-600">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant={tone} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

// --- Icons --------------------------------------------------------------------

const icon = "h-3.5 w-3.5";
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function DesktopIcon() {
  return (
    <svg viewBox="0 0 20 20" {...stroke} className={icon} aria-hidden>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 17h6M10 13.5V17" />
    </svg>
  );
}

export function MobileIcon() {
  return (
    <svg viewBox="0 0 20 20" {...stroke} className={icon} aria-hidden>
      <rect x="5.5" y="2.5" width="9" height="15" rx="1.5" />
      <path d="M9 15h2" />
    </svg>
  );
}

export function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 20 20" {...stroke} className="h-4 w-4" aria-hidden>
      <path d="M10 16V4M5 9l5-5 5 5" />
    </svg>
  );
}

export function ArrowDownIcon() {
  return (
    <svg viewBox="0 0 20 20" {...stroke} className="h-4 w-4" aria-hidden>
      <path d="M10 4v12M5 11l5 5 5-5" />
    </svg>
  );
}

export function DuplicateIcon() {
  return (
    <svg viewBox="0 0 20 20" {...stroke} className="h-4 w-4" aria-hidden>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M13 7V4.5A1.5 1.5 0 0011.5 3h-7A1.5 1.5 0 003 4.5v7A1.5 1.5 0 004.5 13H7" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" {...stroke} className="h-4 w-4" aria-hidden>
      <path d="M3.5 5.5h13M8 5.5V4a1 1 0 011-1h2a1 1 0 011 1v1.5M5 5.5l.8 10.6a1.5 1.5 0 001.5 1.4h5.4a1.5 1.5 0 001.5-1.4L15 5.5M8.5 9v5M11.5 9v5" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" {...stroke} className="h-4 w-4" aria-hidden>
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      {...stroke}
      className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-90")}
      aria-hidden
    >
      <path d="M8 5l5 5-5 5" />
    </svg>
  );
}

export function GripIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-slate-300" aria-hidden>
      <circle cx="7.5" cy="5" r="1.3" />
      <circle cx="12.5" cy="5" r="1.3" />
      <circle cx="7.5" cy="10" r="1.3" />
      <circle cx="12.5" cy="10" r="1.3" />
      <circle cx="7.5" cy="15" r="1.3" />
      <circle cx="12.5" cy="15" r="1.3" />
    </svg>
  );
}
