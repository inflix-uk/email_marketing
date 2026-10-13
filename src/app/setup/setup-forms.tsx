"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { connectDatabase, createAdmin, type SetupFormState } from "./actions";

export function ConnectForm({ initialError }: { initialError?: string }) {
  const [state, action] = useActionState<SetupFormState, FormData>(connectDatabase, {
    error: initialError ? `Could not connect with the saved connection string: ${initialError}` : undefined,
  });
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field
        label="MongoDB connection string"
        htmlFor="uri"
        error={state.fieldErrors?.uri}
        hint={
          <>
            In MongoDB Atlas: <strong>Connect → Drivers</strong>, copy the string and replace{" "}
            <code className="font-mono">&lt;db_password&gt;</code> with your database user&apos;s password.
          </>
        }
      >
        <Input
          id="uri"
          name="uri"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/marketing"
          className="font-mono"
        />
      </Field>
      <SubmitButton className="w-full" pendingText="Connecting...">
        Connect
      </SubmitButton>
    </form>
  );
}

export function AccountForm() {
  const [state, action] = useActionState<SetupFormState, FormData>(createAdmin, {});
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field label="Your email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" error={state.fieldErrors?.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton className="w-full" pendingText="Creating account...">
        Create account
      </SubmitButton>
    </form>
  );
}
