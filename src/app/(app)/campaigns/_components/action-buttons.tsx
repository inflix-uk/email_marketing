"use client";

import { useActionState, useEffect, useId, useRef, type ReactNode } from "react";
import { Button, SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/form";
import type { ActionState } from "../actions";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Variant = "primary" | "secondary" | "danger" | "ghost";

/** One-click server action (e.g. Pause) with its error shown underneath. */
export function ActionButton({
  action,
  children,
  pendingText,
  variant = "secondary",
  size,
}: {
  action: Action;
  children: ReactNode;
  pendingText?: string;
  variant?: Variant;
  size?: "sm" | "md";
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <SubmitButton variant={variant} size={size} pendingText={pendingText}>
        {children}
      </SubmitButton>
      {state.error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** A button that opens a modal confirm step before running the action. */
export function ConfirmButton({
  action,
  label,
  title,
  description,
  confirmLabel,
  dismissLabel = "Cancel",
  pendingText,
  variant = "secondary",
  confirmVariant = "danger",
  size,
  disabled,
  className,
}: {
  action: Action;
  label: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  /** Label of the button that closes the dialog without doing anything. */
  dismissLabel?: ReactNode;
  pendingText?: string;
  variant?: Variant;
  confirmVariant?: Variant;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Classes for the trigger button. */
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [state, formAction] = useActionState(action, {});

  // Most confirmed actions re-render or navigate away; close if we're still here.
  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state]);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        className={className}
        onClick={() => dialogRef.current?.showModal()}
      >
        {label}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-0 text-left shadow-xl ring-1 ring-slate-200 backdrop:bg-slate-900/40"
      >
        <form action={formAction} className="space-y-4 p-6">
          <h2 id={titleId} className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          {description ? (
            <div id={descriptionId} className="text-sm text-slate-600">
              {description}
            </div>
          ) : null}
          {state.error ? <Alert tone="error">{state.error}</Alert> : null}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" autoFocus onClick={() => dialogRef.current?.close()}>
              {dismissLabel}
            </Button>
            <SubmitButton variant={confirmVariant} pendingText={pendingText}>
              {confirmLabel}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
