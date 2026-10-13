"use client";

import { useActionState, useState } from "react";
import { Button, SubmitButton } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { CopyBox } from "../../forms/copy-box";
import { createApiKeyAction, type CreateKeyState } from "./actions";

/** Name + "Create key"; shows the new key once. */
export function CreateKeyForm() {
  const [state, action] = useActionState<CreateKeyState, FormData>(createApiKeyAction, {});

  return (
    <div className="space-y-4">
      {state.created ? (
        <Alert tone="success" className="space-y-3">
          <p>
            <strong className="font-semibold">{state.created.name}</strong> is ready. Copy the key now - it won&apos;t be shown again.
          </p>
          <CopyBox label="API key" value={state.created.key} />
        </Alert>
      ) : null}
      <form action={action} className="flex flex-wrap items-end gap-3">
        <Field label="Key name" htmlFor="api-key-name" error={state.error} className="min-w-56 flex-1">
          <Input id="api-key-name" name="name" required maxLength={60} placeholder="e.g. Website sign-up" />
        </Field>
        <SubmitButton pendingText="Creating..." className={state.error ? "mb-6" : undefined}>
          Create key
        </SubmitButton>
      </form>
    </div>
  );
}

/** Two-step revoke: the first click asks, the second one deletes the key. */
export function RevokeKeyButton({ action, name }: { action: () => Promise<void>; name: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" size="sm" className="text-red-700" onClick={() => setConfirming(true)} aria-label={`Revoke ${name}`}>
        Revoke
      </Button>
    );
  }

  return (
    <form action={action} className="flex items-center justify-end gap-2">
      <span className="text-xs text-slate-500">Apps using it will stop working.</span>
      <SubmitButton variant="danger" size="sm" pendingText="Revoking..." autoFocus>
        Revoke
      </SubmitButton>
      <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </form>
  );
}
