"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Alert, Field, Input, Label } from "@/components/ui/form";
import { login, type LoginState } from "./actions";
import { PasswordInput } from "@/components/ui/password-input";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field label="Email" htmlFor="email">
        {/* Keep the email after a failed attempt (React clears the form when the action finishes). */}
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          key={state.email ?? ""}
          defaultValue={state.email ?? ""}
        />
      </Field>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
            Forgot password?
          </Link>
        </div>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </div>
      <SubmitButton className="w-full" pendingText="Signing in...">
        Sign in
      </SubmitButton>
    </form>
  );
}
