"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { formatNumber } from "@/lib/utils";
import type { ActionState } from "../actions";
import { ConfirmButton } from "../_components/action-buttons";
import { useIsClient, useTimeZone } from "../_components/local-time";
import { useEditorState } from "./editor-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function recipientsLabel(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? "recipient" : "recipients"}`;
}

/** Submit through a transition so the fields aren't reset when the action returns an error. */
function submitKeepingValues(formAction: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };
}

export function SendTestForm({ action, defaultTo }: { action: Action; defaultTo: string }) {
  const { dirty } = useEditorState();
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form onSubmit={submitKeepingValues(formAction)} className="space-y-1.5">
      <Label htmlFor="test-to">Send a test</Label>
      <div className="flex gap-2">
        <Input
          id="test-to"
          name="to"
          inputMode="email"
          autoComplete="email"
          defaultValue={defaultTo}
          placeholder="you@example.com"
          required
          aria-describedby="test-to-hint"
          aria-invalid={state.fieldErrors?.to ? true : undefined}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Sending..." : "Send test"}
        </Button>
      </div>
      <p id="test-to-hint" className="text-xs text-slate-500">
        Up to 5 addresses, separated by commas.{" "}
        {dirty ? "Save first to include your latest changes." : "Merge tags use sample data."}
      </p>
      {state.error ? (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      ) : state.ok ? (
        <p role="status" className="text-xs text-emerald-700">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function SendNowButton({
  action,
  recipients,
  blocked,
}: {
  action: Action;
  recipients: number;
  /** The campaign has problems that must be fixed first. */
  blocked: boolean;
}) {
  const { dirty } = useEditorState();
  const label = recipientsLabel(recipients);

  return (
    <div className="space-y-1.5">
      <ConfirmButton
        action={action}
        label="Send now"
        variant="primary"
        confirmVariant="primary"
        className="w-full"
        disabled={blocked || dirty}
        title={`Send to ${label} now?`}
        description={
          <p>
            The email starts going out immediately and can&apos;t be unsent. You can still pause or cancel while it&apos;s
            sending.
          </p>
        }
        confirmLabel={`Send to ${label}`}
        pendingText="Starting..."
      />
      {dirty ? (
        <p className="text-xs text-amber-700">Save your changes before sending.</p>
      ) : blocked ? (
        <p className="text-xs text-slate-500">Fix the items above to enable sending.</p>
      ) : null}
    </div>
  );
}

/** "YYYY-MM-DDTHH:mm" in the browser's timezone, for a datetime-local input. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleForm({
  action,
  scheduledAt,
  blocked,
}: {
  action: Action;
  /** ISO string when the campaign is already scheduled. */
  scheduledAt: string | null;
  blocked: boolean;
}) {
  const { dirty } = useEditorState();
  const isClient = useIsClient();
  const timeZone = useTimeZone();
  const [state, formAction, pending] = useActionState(action, {});
  const [clientError, setClientError] = useState<string | null>(null);

  // datetime-local has no timezone: read it as the browser's local time and
  // send the server an absolute ISO timestamp.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const local = new FormData(event.currentTarget).get("when");
    const when = typeof local === "string" && local ? new Date(local) : null;
    if (!when || Number.isNaN(when.getTime())) {
      setClientError("Pick a date and time.");
      return;
    }
    if (when.getTime() <= Date.now()) {
      setClientError("Pick a time in the future.");
      return;
    }
    setClientError(null);
    const formData = new FormData();
    formData.set("scheduledAt", when.toISOString());
    startTransition(() => formAction(formData));
  }

  const error = clientError ?? state.error;

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      <Label htmlFor="schedule-at">{scheduledAt ? "Change the send time" : "Or schedule it for later"}</Label>
      <div className="flex gap-2">
        <Input
          // Remount once hydrated: the default value depends on the browser's timezone.
          key={isClient ? "client" : "server"}
          id="schedule-at"
          name="when"
          type="datetime-local"
          defaultValue={isClient && scheduledAt ? toLocalInputValue(scheduledAt) : undefined}
          required
          disabled={blocked}
          aria-describedby="schedule-at-hint"
          aria-invalid={error ? true : undefined}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" disabled={blocked || dirty || pending}>
          {pending ? "Saving..." : scheduledAt ? "Reschedule" : "Schedule"}
        </Button>
      </div>
      <p id="schedule-at-hint" className="text-xs text-slate-500">
        {timeZone ? <>Times are in your timezone ({timeZone}).</> : <>Times are in your local timezone.</>}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : state.ok ? (
        <p role="status" className="text-xs text-emerald-700">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
