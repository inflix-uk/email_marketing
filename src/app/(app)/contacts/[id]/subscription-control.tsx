"use client";

import { useActionState, useState } from "react";
import { Button, SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/layout";
import type { ContactStatus } from "@/db/schema";
import type { SubscriptionState } from "../actions";

/**
 * Status badge plus one button: Unsubscribe, or Subscribe (with a short
 * confirmation, because only people who agreed may be emailed again).
 * Render it with `key={status}` so it starts fresh after a change.
 */
export function SubscriptionControl({
  status,
  unsubscribeAction,
  subscribeAction,
}: {
  status: ContactStatus;
  unsubscribeAction: (state: SubscriptionState) => Promise<SubscriptionState>;
  subscribeAction: (state: SubscriptionState, formData: FormData) => Promise<SubscriptionState>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [unsubState, unsubscribe] = useActionState(unsubscribeAction, {});
  const [subState, subscribe] = useActionState(subscribeAction, {});
  const error = status === "subscribed" ? unsubState.error : subState.error;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-500">Status</span>
        <StatusBadge status={status} />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}

      {status === "subscribed" ? (
        <form action={unsubscribe}>
          <SubmitButton variant="secondary" pendingText="Unsubscribing..." className="w-full">
            Unsubscribe
          </SubmitButton>
        </form>
      ) : confirming ? (
        <form action={subscribe} className="space-y-2 rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
          <p className="text-sm text-slate-700">Only do this if they agreed to get your emails.</p>
          {/* The click on "Yes, subscribe" is the consent the server action asks for. */}
          <input type="hidden" name="consent" value="on" />
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Subscribing..." autoFocus>
              Yes, subscribe
            </SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="secondary" className="w-full" onClick={() => setConfirming(true)}>
          Subscribe
        </Button>
      )}
    </div>
  );
}
