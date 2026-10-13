"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Alert, Field, Input, Textarea } from "@/components/ui/form";
import type { ListFormState } from "./actions";

/** Name + description form, used to create a list and to edit one. */
export function ListForm({
  action,
  initial = { name: "", description: "" },
  submitLabel,
  pendingLabel,
  idPrefix,
}: {
  action: (state: ListFormState, formData: FormData) => Promise<ListFormState>;
  initial?: { name: string; description: string };
  submitLabel: string;
  pendingLabel: string;
  /** Keeps input ids unique when two forms are on one page. */
  idPrefix: string;
}) {
  const [state, formAction] = useActionState(action, {});
  // React resets the form after each action; on errors the typed values come
  // back in `state.values`, otherwise the (revalidated) saved values are used.
  const values = state.values ?? initial;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">List saved.</Alert> : null}
      <Field label="Name" htmlFor={`${idPrefix}-name`} error={errors.name}>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={100}
          defaultValue={values.name}
          placeholder="e.g. Newsletter"
          aria-invalid={errors.name ? true : undefined}
        />
      </Field>
      <Field
        label={
          <>
            Description <span className="font-normal text-slate-400">(optional)</span>
          </>
        }
        htmlFor={`${idPrefix}-description`}
        error={errors.description}
        hint="For your team - subscribers don't see it."
      >
        <Textarea
          id={`${idPrefix}-description`}
          name="description"
          rows={2}
          maxLength={500}
          defaultValue={values.description}
          placeholder="Who is on this list and what they signed up for"
        />
      </Field>
      <SubmitButton pendingText={pendingLabel}>{submitLabel}</SubmitButton>
    </form>
  );
}
