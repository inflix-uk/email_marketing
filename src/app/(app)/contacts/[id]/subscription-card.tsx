"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import type { ContactStatus } from "@/db/schema";
import { formatDateTime } from "@/lib/utils";
import type { SubscriptionState } from "../actions";

const EXPLANATIONS: Record<Exclude<ContactStatus, "subscribed">, string> = {
  unsubscribed: "This person opted out. They won't receive any campaigns.",
  bounced: "Emails to this address bounced, so it's excluded from sending.",
  complained: "This person marked one of your emails as spam. They won't receive any campaigns.",
};

/** Shows the subscription status and the (deliberately explicit) controls to change it. */
export function SubscriptionCard({
  status,
  unsubscribedAt,
  unsubscribeAction,
  resubscribeAction,
}: {
  status: ContactStatus;
  unsubscribedAt: Date | null;
  unsubscribeAction: (state: SubscriptionState) => Promise<SubscriptionState>;
  resubscribeAction: (state: SubscriptionState, formData: FormData) => Promise<SubscriptionState>;
}) {
  const [consent, setConsent] = useState(false);
  const [unsubState, unsubscribe] = useActionState(unsubscribeAction, {});
  const [resubState, resubscribe] = useActionState(async (prev: SubscriptionState, formData: FormData) => {
    const next = await resubscribeAction(prev, formData);
    setConsent(false); // React resets the form after the action; keep the checkbox state in sync
    return next;
  }, {});
  const result = status === "subscribed" ? unsubState : resubState;

  return (
    <Card>
      <CardHeader title="Subscription" />
      <CardBody className="space-y-4">
        {result.message ? <Alert tone="success">{result.message}</Alert> : null}
        {result.error ? <Alert tone="error">{result.error}</Alert> : null}

        {status === "subscribed" ? (
          <form action={unsubscribe} className="space-y-3">
            <p className="text-sm text-slate-600">Subscribed - receives campaigns sent to their lists.</p>
            <SubmitButton variant="secondary" pendingText="Unsubscribing...">
              Unsubscribe
            </SubmitButton>
            <p className="text-xs text-slate-500">Use this when someone asks to stop receiving emails.</p>
          </form>
        ) : (
          <>
            <div className="text-sm text-slate-600">
              <p>{EXPLANATIONS[status]}</p>
              {unsubscribedAt ? (
                <p className="mt-1 text-slate-500">
                  {status === "unsubscribed" ? "Unsubscribed" : "Since"} {formatDateTime(unsubscribedAt)}
                </p>
              ) : null}
            </div>
            <form action={resubscribe} className="space-y-3 rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
              <p className="text-sm font-medium text-slate-900">Re-subscribe</p>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="consent"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                />
                <span>I have this person&apos;s consent to email them again.</span>
              </label>
              <SubmitButton variant="secondary" size="sm" disabled={!consent} pendingText="Re-subscribing...">
                Re-subscribe contact
              </SubmitButton>
            </form>
          </>
        )}
      </CardBody>
    </Card>
  );
}
