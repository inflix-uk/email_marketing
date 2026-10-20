"use client";

import { useActionState } from "react";
import { ButtonLink, SubmitButton } from "@/components/ui/button";
import { Alert, Field } from "@/components/ui/form";
import { setNewPassword, type ResetPasswordState } from "./actions";
import { PasswordInput } from "@/components/ui/password-input";

/** Shown instead of the form when the link is missing, used or expired. */
export function LinkExpired() {
  return (
    <div className="space-y-4">
      <Alert tone="warning">This link doesn&apos;t work any more. Links can be used once and expire after a while.</Alert>
      <ButtonLink href="/forgot-password" className="w-full">
        Get a new link
      </ButtonLink>
    </div>
  );
}

export function ResetPasswordForm({
  token,
  email,
  minLength,
  maxLength,
}: {
  token: string;
  email: string;
  minLength: number;
  maxLength: number;
}) {
  const [state, action] = useActionState<ResetPasswordState, FormData>(setNewPassword, {});

  if (state.expired) return <LinkExpired />;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the new password under the right account. */}
      <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field
        label="New password"
        htmlFor="password"
        error={state.fieldErrors?.password}
        hint={`At least ${minLength} characters.`}
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={minLength}
          maxLength={maxLength}
          required
          autoFocus
        />
      </Field>
      <Field label="Type it again" htmlFor="confirm" error={state.fieldErrors?.confirm}>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required />
      </Field>
      <SubmitButton className="w-full" pendingText="Saving...">
        Save password and sign in
      </SubmitButton>
    </form>
  );
}
