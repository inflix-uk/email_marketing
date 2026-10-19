"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Alert, Field, Textarea } from "@/components/ui/form";
import { formatNumber } from "@/lib/utils";
import type { AddEmailsState } from "../actions";

/** Paste addresses to add them to the list; unknown addresses become new contacts. */
export function AddEmailsForm({ action }: { action: (state: AddEmailsState, formData: FormData) => Promise<AddEmailsState> }) {
  const [state, formAction] = useActionState(action, {});
  const { result } = state;

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {result ? (
        <Alert tone="success">
          Added {formatNumber(result.added)}
          {result.alreadyInList > 0 ? `, ${formatNumber(result.alreadyInList)} already on the list` : ""}.
          {result.notSubscribed > 0
            ? ` ${formatNumber(result.notSubscribed)} of them ${result.notSubscribed === 1 ? "isn't" : "aren't"} subscribed, so won't get emails.`
            : ""}
        </Alert>
      ) : null}
      {state.invalidCount ? (
        <Alert tone="warning">
          Skipped {formatNumber(state.invalidCount)} that {state.invalidCount === 1 ? "isn't an email address" : "aren't email addresses"}:{" "}
          <span className="break-all">{state.invalid?.join(", ")}</span>
          {state.invalidCount > (state.invalid?.length ?? 0) ? " ..." : ""}
        </Alert>
      ) : null}
      <Field label="Email addresses" htmlFor="add-emails" hint="One per line, or separated by commas.">
        <Textarea
          id="add-emails"
          name="emails"
          rows={4}
          required
          defaultValue={state.text ?? ""}
          placeholder={"jane@example.com\nbob@example.com"}
        />
      </Field>
      <SubmitButton pendingText="Adding...">Add to list</SubmitButton>
    </form>
  );
}
