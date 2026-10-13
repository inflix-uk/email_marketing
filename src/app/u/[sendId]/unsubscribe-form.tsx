"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/form";
import { unsubscribeAction, type UnsubscribeState } from "./actions";

// Email preferences: leave individual lists, or unsubscribe from everything.
// One plain <form> with two submit buttons (`intent`), so it works without
// JavaScript. The action result is checked first: after a no-JS form post
// Next re-renders the page with this state restored.

export function UnsubscribeForm({
  sendId,
  signature,
  maskedEmail,
  alreadyUnsubscribed,
  lists,
}: {
  sendId: string;
  signature: string;
  maskedEmail: string;
  alreadyUnsubscribed: boolean;
  /** The lists this contact is on. */
  lists: { id: string; name: string }[];
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

  const current = state.lists ?? lists;
  const email = <strong className="font-medium text-slate-900">{maskedEmail}</strong>;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="sendId" value={sendId} />
      <input type="hidden" name="s" value={signature} />
      {state.done === "saved" ? <Alert tone="success">Your email preferences have been saved.</Alert> : null}
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      {current.length > 0 ? (
        <fieldset className="space-y-3">
          <legend className="mb-3">{email} receives these emails. Untick the ones you no longer want:</legend>
          <div className="space-y-2">
            {current.map((list) => (
              <label key={list.id} className="flex items-start gap-2.5 text-slate-900">
                <input type="hidden" name="shown" value={list.id} />
                <input
                  type="checkbox"
                  name="keep"
                  value={list.id}
                  defaultChecked
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                />
                <span className="min-w-0 break-words">{list.name}</span>
              </label>
            ))}
          </div>
          <SubmitButton name="intent" value="save" variant="secondary" className="w-full">
            Save preferences
          </SubmitButton>
        </fieldset>
      ) : (
        <p>Do you want to stop receiving marketing emails at {email}?</p>
      )}

      <SubmitButton name="intent" value="all" className="w-full">
        {current.length > 0 ? "Unsubscribe from all emails" : "Unsubscribe"}
      </SubmitButton>
    </form>
  );
}
