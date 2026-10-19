"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Alert, Input, Label } from "@/components/ui/form";
import type { ListFormState } from "./actions";

/** One-line list name form: creates a list, or renames one. */
export function ListForm({
  action,
  initialName = "",
  label,
  submitLabel,
  pendingLabel,
  idPrefix,
}: {
  action: (state: ListFormState, formData: FormData) => Promise<ListFormState>;
  initialName?: string;
  label: string;
  submitLabel: string;
  pendingLabel: string;
  /** Keeps input ids unique when two forms are on one page. */
  idPrefix: string;
}) {
  const [state, formAction] = useActionState(action, {});
  // React resets the form after each action; on errors the typed name comes
  // back in `state.values`, otherwise the (revalidated) saved name is used.
  const name = state.values?.name ?? initialName;
  const error = state.fieldErrors?.name ?? state.error;

  return (
    <form action={formAction} className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-name`}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={100}
          defaultValue={name}
          placeholder="e.g. Newsletter"
          aria-invalid={error ? true : undefined}
          className="min-w-0"
        />
        <SubmitButton pendingText={pendingLabel}>{submitLabel}</SubmitButton>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {state.ok ? (
        <Alert tone="success" className="py-2">
          Saved.
        </Alert>
      ) : null}
    </form>
  );
}
