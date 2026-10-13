"use client";

import { useActionState } from "react";
import { ButtonLink, SubmitButton } from "@/components/ui/button";
import { Alert, Field, Textarea } from "@/components/ui/form";
import { formatNumber } from "@/lib/utils";
import { suppressEmailsAction } from "../actions";

function plural(n: number, one: string, many: string) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** Paste addresses that must never be emailed; reports what happened to them. */
export function SuppressForm() {
  const [state, formAction] = useActionState(suppressEmailsAction, {});
  const { result } = state;

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {result ? (
        <Alert tone="success">
          <p className="font-medium">
            {plural(result.unsubscribed + result.created + result.alreadySuppressed, "address is", "addresses are")} now
            suppressed.
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>{plural(result.unsubscribed, "existing contact", "existing contacts")} unsubscribed</li>
            <li>{plural(result.created, "new address", "new addresses")} added as unsubscribed</li>
            <li>{plural(result.alreadySuppressed, "was", "were")} already unsubscribed or bounced</li>
          </ul>
        </Alert>
      ) : null}
      {state.invalidCount ? (
        <Alert tone="warning">
          Skipped {plural(state.invalidCount, "entry that isn't", "entries that aren't")} a valid email address:{" "}
          <span className="break-all font-mono text-xs">{state.invalid?.join(", ")}</span>
          {state.invalidCount > (state.invalid?.length ?? 0) ? " ..." : ""}
        </Alert>
      ) : null}
      <Field label="Email addresses" htmlFor="suppress-emails" hint="One per line, or separated by commas. Up to 5,000 at a time.">
        <Textarea
          id="suppress-emails"
          name="emails"
          rows={8}
          required
          defaultValue={state.text ?? ""}
          placeholder={"jane@example.com\nbob@example.com"}
          className="font-mono text-xs"
        />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <ButtonLink href="/contacts?status=unsubscribed" variant="secondary">
          View unsubscribed contacts
        </ButtonLink>
        <SubmitButton pendingText="Suppressing...">Suppress addresses</SubmitButton>
      </div>
    </form>
  );
}
