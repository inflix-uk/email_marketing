"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/form";
import { unsubscribeAction, type UnsubscribeState } from "./actions";

// The action result is checked first: after a no-JS form post Next re-renders
// the page (where the contact is now unsubscribed) with this state restored.

export function UnsubscribeForm({
  sendId,
  signature,
  maskedEmail,
  alreadyUnsubscribed,
}: {
  sendId: string;
  signature: string;
  maskedEmail: string;
  alreadyUnsubscribed: boolean;
}) {
  const [state, action] = useActionState<UnsubscribeState, FormData>(unsubscribeAction, {});

  if (state.done === "unsubscribed") {
    return (
      <Alert tone="success">
        You&apos;ve been unsubscribed - you won&apos;t receive further marketing emails from us.
      </Alert>
    );
  }

  if (state.done === "already" || alreadyUnsubscribed) {
    return (
      <p>
        <strong className="font-medium text-slate-900">{maskedEmail}</strong> is already unsubscribed - you won&apos;t
        receive further marketing emails from us.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="sendId" value={sendId} />
      <input type="hidden" name="s" value={signature} />
      <p>
        Do you want to stop receiving marketing emails at{" "}
        <strong className="font-medium text-slate-900">{maskedEmail}</strong>?
      </p>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <SubmitButton className="w-full" pendingText="Unsubscribing...">
        Unsubscribe
      </SubmitButton>
    </form>
  );
}
