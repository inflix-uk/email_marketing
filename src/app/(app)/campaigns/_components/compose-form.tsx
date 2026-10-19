"use client";

import Link from "next/link";
import { startTransition, useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { EmailPreview, EmailThumbnail } from "@/components/email-editor";
import { Button } from "@/components/ui/button";
import { Alert, Input } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { cn, formatNumber } from "@/lib/utils";
import { estimateRecipients, submitCampaign, type ActionState, type ComposeNotice } from "../actions";
import type { ComposeData } from "../_lib/compose-data";
import { displaySubject } from "../_lib/display";
import { useIsClient, useTimeZone } from "./local-time";

const NOTICES: Record<ComposeNotice, { tone: "success" | "error"; text: string }> = {
  saved: { tone: "success", text: "Draft saved." },
  "test-sent": { tone: "success", text: "Test email sent." },
  "test-failed": { tone: "error", text: "The test email couldn't be sent. Check Settings → Email sending." },
  scheduled: { tone: "success", text: "Scheduled." },
};

function people(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? "person" : "people"}`;
}

/** "YYYY-MM-DDTHH:mm" in the browser's timezone, for a datetime-local input. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The whole campaign on one screen: subject, design, lists, then send. */
export function ComposeForm({
  campaignId,
  initialSubject,
  scheduledAt,
  data,
  defaultTestTo,
  notice,
}: {
  campaignId: string | null;
  initialSubject: string;
  /** ISO string when the campaign is scheduled. */
  scheduledAt: string | null;
  data: ComposeData;
  defaultTestTo: string;
  notice?: ComposeNotice;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(submitCampaign.bind(null, campaignId), {});
  const [intent, setIntent] = useState<string | null>(null);
  const [subject, setSubject] = useState(initialSubject);
  const [design, setDesign] = useState(data.initialDesign);
  const [listIds, setListIds] = useState<string[]>(data.initialListIds);
  const [recipients, setRecipients] = useState(data.initialRecipients);
  const [counting, startCounting] = useTransition();
  const latestCount = useRef(0);
  const [showSchedule, setShowSchedule] = useState(Boolean(scheduledAt));
  const [clientError, setClientError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const isClient = useIsClient();
  const timeZone = useTimeZone();

  const current = data.designs.find((d) => d.value === design) ?? data.designs[0];

  function chooseDesign(value: string) {
    const next = data.designs.find((d) => d.value === value);
    // Suggest the design's subject unless the user has written their own.
    if (next?.subject && (!subject.trim() || subject === current?.subject)) setSubject(next.subject);
    setDesign(value);
  }

  function toggleList(id: string, checked: boolean) {
    const next = checked ? [...listIds, id] : listIds.filter((other) => other !== id);
    setListIds(next);
    const request = ++latestCount.current;
    startCounting(async () => {
      const total = next.length ? await estimateRecipients(next) : 0;
      if (request === latestCount.current) setRecipients(total);
    });
  }

  // Submit through a transition so nothing typed is reset, and send the clicked button's intent.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    const chosen = String(formData.get("intent") ?? "save");
    if (chosen === "schedule") {
      const local = formData.get("when");
      const when = typeof local === "string" && local ? new Date(local) : null;
      if (!when || Number.isNaN(when.getTime())) return setClientError("Pick a date and time.");
      if (when.getTime() <= Date.now()) return setClientError("Pick a time in the future.");
      formData.set("scheduledAt", when.toISOString());
    }
    setClientError(null);
    setIntent(chosen);
    confirmRef.current?.close();
    startTransition(() => formAction(formData));
  }

  const busy = (name: string) => pending && intent === name;
  const error = clientError ?? state.error;
  const shownNotice = !state.ok && !state.error && notice ? NOTICES[notice] : null;

  return (
    <form onSubmit={handleSubmit} className="grid items-start gap-6 xl:grid-cols-5">
      <Card className="xl:col-span-3">
        <div className="space-y-6 p-5">
          {/* Subject */}
          <div className="space-y-1.5">
            <label htmlFor="subject" className="block text-sm font-medium text-slate-900">
              Subject
            </label>
            <Input
              id="subject"
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
              autoFocus={!campaignId}
              placeholder="What's this email about?"
              aria-invalid={state.fieldErrors?.subject ? true : undefined}
            />
            {state.fieldErrors?.subject ? <p className="text-xs text-red-600">{state.fieldErrors.subject[0]}</p> : null}
          </div>

          {/* Design */}
          <fieldset className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <legend className="text-sm font-medium text-slate-900">Template</legend>
              <span className="flex gap-4 text-sm">
                {current?.templateId ? (
                  <Link href={`/templates/${current.templateId}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                    Edit this template
                  </Link>
                ) : null}
                <Link href="/templates/new" className="font-medium text-indigo-600 hover:text-indigo-500">
                  New template
                </Link>
              </span>
            </div>
            {state.fieldErrors?.source ? <p className="text-xs text-red-600">{state.fieldErrors.source[0]}</p> : null}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.designs.map((option) => {
                const checked = option.value === current?.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "cursor-pointer overflow-hidden rounded-lg border bg-white transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600",
                      checked ? "border-indigo-600 ring-1 ring-indigo-600" : "border-slate-200 hover:border-slate-300",
                    )}
                  >
                    <input
                      type="radio"
                      name="source"
                      value={option.value}
                      checked={checked}
                      onChange={() => chooseDesign(option.value)}
                      className="sr-only"
                    />
                    <EmailThumbnail html={option.html} className="aspect-[4/3] border-b border-slate-100" />
                    <span className={cn("block truncate px-3 py-2 text-sm", checked ? "font-semibold text-indigo-700" : "text-slate-700")}>
                      {option.name}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* Lists */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-900">Send to</legend>
            {data.lists.length === 0 ? (
              <p className="text-sm text-slate-500">
                You don&apos;t have any lists yet.{" "}
                <Link href="/lists" className="font-medium text-indigo-600 hover:text-indigo-500">
                  Create a list
                </Link>
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {data.lists.map((list) => {
                    const checked = listIds.includes(list.id);
                    return (
                      <label
                        key={list.id}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600",
                          checked ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-slate-200 text-slate-700 hover:border-slate-300",
                        )}
                      >
                        <input
                          type="checkbox"
                          name="listIds"
                          value={list.id}
                          checked={checked}
                          onChange={(e) => toggleList(list.id, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                        />
                        {list.name}
                        <span className="tabular-nums text-slate-400">{formatNumber(list.subscribed)}</span>
                      </label>
                    );
                  })}
                </div>
                <p className={cn("text-sm", state.fieldErrors?.listIds ? "text-red-600" : "text-slate-500")} aria-live="polite">
                  {listIds.length === 0
                    ? "Choose at least one list."
                    : counting
                      ? "Counting..."
                      : `${people(recipients)} will get this email.`}
                </p>
              </>
            )}
          </fieldset>
        </div>

        {/* Actions */}
        <div className="space-y-3 border-t border-slate-200 bg-slate-50/60 px-5 py-4">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {state.warning ? <Alert tone="warning">{state.warning}</Alert> : null}
          {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}
          {shownNotice ? <Alert tone={shownNotice.tone}>{shownNotice.text}</Alert> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={pending} onClick={() => confirmRef.current?.showModal()}>
              {busy("send") ? "Sending..." : "Send now"}
            </Button>
            <Button type="submit" name="intent" value="save" variant="secondary" disabled={pending}>
              {busy("save") ? "Saving..." : "Save draft"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setShowSchedule((v) => !v)}>
              {scheduledAt ? "Change time" : "Schedule"}
            </Button>
            <span className="ml-auto flex items-center gap-2">
              <span className="w-56">
                <Input name="testTo" inputMode="email" defaultValue={defaultTestTo} aria-label="Send a test to" />
              </span>
              <Button type="submit" name="intent" value="test" variant="secondary" disabled={pending}>
                {busy("test") ? "Sending..." : "Send test"}
              </Button>
            </span>
          </div>

          {showSchedule ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-60">
                <Input
                  // Remount once hydrated: the default value depends on the browser's timezone.
                  key={isClient ? "client" : "server"}
                  name="when"
                  type="datetime-local"
                  aria-label="Send at"
                  defaultValue={isClient && scheduledAt ? toLocalInputValue(scheduledAt) : undefined}
                />
              </div>
              <Button type="submit" name="intent" value="schedule" variant="secondary" disabled={pending}>
                {busy("schedule") ? "Scheduling..." : scheduledAt ? "Reschedule" : "Schedule"}
              </Button>
              {timeZone ? <span className="text-xs text-slate-500">Your time ({timeZone})</span> : null}
            </div>
          ) : null}
        </div>

        <dialog
          ref={confirmRef}
          aria-labelledby="confirm-send-title"
          className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg bg-white p-0 text-left shadow-xl ring-1 ring-slate-200 backdrop:bg-slate-900/40"
        >
          <div className="space-y-4 p-6">
            <h2 id="confirm-send-title" className="text-base font-semibold text-slate-900">
              {listIds.length ? `Send to ${people(recipients)} now?` : "Send now?"}
            </h2>
            <p className="text-sm text-slate-600">This can&apos;t be undone.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" autoFocus onClick={() => confirmRef.current?.close()}>
                Cancel
              </Button>
              <Button type="submit" name="intent" value="send">
                Send
              </Button>
            </div>
          </div>
        </dialog>
      </Card>

      <aside aria-label="Preview" className="xl:sticky xl:top-6 xl:col-span-2">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-2.5 text-sm">
            <p className="truncate font-medium text-slate-900">{displaySubject(subject) || <span className="text-slate-400">No subject yet</span>}</p>
          </div>
          {current ? <EmailPreview html={current.html} height={620} /> : null}
        </Card>
      </aside>
    </form>
  );
}
