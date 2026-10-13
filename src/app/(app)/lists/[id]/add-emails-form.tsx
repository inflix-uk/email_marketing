"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Alert, Field, Textarea } from "@/components/ui/form";
import { formatNumber } from "@/lib/utils";
import type { AddEmailsState } from "../actions";

function plural(n: number, one: string, many: string) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** Paste addresses to add them to the list; unknown addresses become new contacts. */
export function AddEmailsForm({ action }: { action: (state: AddEmailsState, formData: FormData) => Promise<AddEmailsState> }) {
  const [state, formAction] = useActionState(action, {});
  const { result } = state;

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {result ? (
        <Alert tone="success">
          <p>
            Added {plural(result.added, "contact", "contacts")} to this list
            {result.created > 0 ? ` (${plural(result.created, "new contact", "new contacts")} created)` : ""}.
            {result.alreadyInList > 0 ? ` ${plural(result.alreadyInList, "was", "were")} already on it.` : ""}
          </p>
          {result.notSubscribed > 0 ? (
            <p className="mt-1">
              {plural(result.notSubscribed, "contact is", "contacts are")} unsubscribed or bounced and won&apos;t receive
              campaigns.
            </p>
          ) : null}
        </Alert>
      ) : null}
      {state.invalidCount ? (
        <Alert tone="warning">
          Skipped {plural(state.invalidCount, "entry that isn't", "entries that aren't")} a valid email address:{" "}
          <span className="break-all font-mono text-xs">{state.invalid?.join(", ")}</span>
          {state.invalidCount > (state.invalid?.length ?? 0) ? " ..." : ""}
        </Alert>
      ) : null}
      <Field
        label="Email addresses"
        htmlFor="add-emails"
        hint="One per line, or separated by commas. New addresses are added as subscribed contacts."
      >
        <Textarea
          id="add-emails"
          name="emails"
          rows={5}
          required
          defaultValue={state.text ?? ""}
          placeholder={"jane@example.com\nbob@example.com"}
          className="font-mono text-xs"
        />
      </Field>
      <SubmitButton pendingText="Adding...">Add to list</SubmitButton>
    </form>
  );
}
