"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

export function ForgotPasswordForm({ linkHours }: { linkHours: number }) {
  const [state, action] = useActionState<ForgotPasswordState, FormData>(requestPasswordReset, {});

  if (state.sent) {
    return (
      <Alert tone="success">
        If that account exists, we&apos;ve emailed a link to choose a new password. It works for {linkHours}{" "}
        {linkHours === 1 ? "hour" : "hours"} - check your spam folder too.
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <SubmitButton className="w-full" pendingText="Sending...">
        Email me a link
      </SubmitButton>
    </form>
  );
}
