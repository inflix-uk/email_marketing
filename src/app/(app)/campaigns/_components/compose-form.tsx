"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { EmailPreview, EmailThumbnail } from "@/components/email-editor";
import { Button } from "@/components/ui/button";
import { Alert, Input, Select, Textarea } from "@/components/ui/form";
import { PersonalisationExample, PersonalisationFields, PersonaliseSelect } from "@/components/personalise-select";
import { Card } from "@/components/ui/layout";
import type { CampaignFormat } from "@/db/schema";
import { newTemplateHrefForCampaign, templateHrefForCampaign, worthAutosaving } from "@/lib/campaigns/drafts";
import { personalisationExample } from "@/lib/personalisation";
import { htmlToPlainText, isTextVersionStale } from "@/lib/plain-text";
import { checkSchedule, DEFAULT_TIME_ZONE, formatUtcOffset, zonedLocalToUtc } from "@/lib/schedule";
import { cn, formatNumber } from "@/lib/utils";
import { autosaveCampaign, estimateRecipients, submitCampaign, type ActionState, type ComposeNotice } from "../actions";
import type { ComposeData } from "../_lib/compose-data";
import { displaySubject } from "../_lib/display";

const NOTICES: Record<ComposeNotice, { tone: "success" | "error"; text: string }> = {
  saved: { tone: "success", text: "Draft saved. You'll find it under Campaigns → Drafts." },
  created: { tone: "success", text: "Campaign draft created from your template. It's in Drafts and saves automatically." },
  "design-saved": { tone: "success", text: "Email design saved to this campaign." },
  "test-sent": { tone: "success", text: "Test email sent." },
  "test-failed": { tone: "error", text: "The test email couldn't be sent. Check Settings → Email sending." },
  scheduled: { tone: "success", text: "Scheduled." },
};

const PREVIEW_TEXT_MAX = 250;

/** Wait this long after the last change before autosaving a draft. */
const AUTOSAVE_DELAY_MS = 1500;

type AutosaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; message: string };

function people(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? "person" : "people"}`;
}

/** The stored campaign values the form starts from. */
export interface ComposeInitial {
  subject: string;
  name: string;
  previewText: string;
  replyTo: string;
  format: CampaignFormat;
  textBody: string;
  /** Fingerprint of the HTML the text version was written for. */
  textBodyFor: string | null;
  /** Wall-clock send time + timezone when scheduled. */
  scheduledLocal: string | null;
  scheduledTimeZone: string | null;
}

/** The whole campaign on one screen: subject, design, lists, then send. */
export function ComposeForm({
  campaignId,
  initial,
  data,
  defaultTestTo,
  notice,
  typeOptions,
  autosave = false,
}: {
  /** Save quietly while typing (drafts and new campaigns; not scheduled ones). */
  autosave?: boolean;
  /** Campaign type section (A/B test, auto resend, RSS) - see ./type-options.tsx. */
  typeOptions?: ReactNode;
  campaignId: string | null;
  initial: ComposeInitial;
  data: ComposeData;
  defaultTestTo: string;
  notice?: ComposeNotice;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(submitCampaign.bind(null, campaignId), {});
  const [intent, setIntent] = useState<string | null>(null);
  const [subject, setSubject] = useState(initial.subject);
  const [previewText, setPreviewText] = useState(initial.previewText);
  const subjectRef = useRef<HTMLInputElement>(null);
  const previewTextRef = useRef<HTMLInputElement>(null);
  const [design, setDesign] = useState(data.initialDesign);
  const [listIds, setListIds] = useState<string[]>(data.initialListIds);
  const [recipients, setRecipients] = useState(data.initialRecipients);
  const [counting, startCounting] = useTransition();
  const latestCount = useRef(0);
  const [format, setFormat] = useState<CampaignFormat>(initial.format);
  const [textBody, setTextBody] = useState(initial.textBody);
  const [textTouched, setTextTouched] = useState(false);
  const [showSchedule, setShowSchedule] = useState(Boolean(initial.scheduledLocal));
  const [when, setWhen] = useState(initial.scheduledLocal ?? "");
  const [timeZone, setTimeZone] = useState(initial.scheduledTimeZone ?? DEFAULT_TIME_ZONE);
  const [clientError, setClientError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  // Blocks a second submit before React re-renders with `pending` (double click on Send).
  const inFlight = useRef(false);
  useEffect(() => {
    if (!pending) inFlight.current = false;
  }, [pending]);

  // --- Autosave: a draft is saved a moment after each change, so it is never
  // lost and always shows under Drafts. A new campaign gets its id (and URL) on
  // the first autosave; explicit buttons then save that same campaign.
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const idRef = useRef<string | null>(campaignId);
  const [autoStatus, setAutoStatus] = useState<AutosaveStatus>({ kind: "idle" });
  const [leaving, setLeaving] = useState(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const autoRunning = useRef<Promise<boolean> | null>(null);

  const autosaveNow = useCallback(async (): Promise<boolean> => {
    while (autoRunning.current) await autoRunning.current;
    if (!autosave || !dirty.current) return false;
    const form = formRef.current;
    // An explicit Save / Send / Test is on its way: it saves everything itself.
    if (!form || inFlight.current) return false;
    const formData = new FormData(form);
    if (!worthAutosaving({ subject: String(formData.get("subject") ?? ""), hasDesign: Boolean(formData.get("source")) })) return false;
    formData.set("intent", "save");
    dirty.current = false;
    setAutoStatus({ kind: "saving" });
    const job = (async () => {
      try {
        const result = await autosaveCampaign(idRef.current, formData);
        if (result.ok && result.id) {
          if (!idRef.current) {
            idRef.current = result.id;
            // The draft has its own page now (Next.js keeps its router in sync).
            window.history.replaceState(null, "", `/campaigns/${result.id}`);
          }
          setAutoStatus({ kind: "saved", at: new Date() });
          return true;
        }
        dirty.current = true;
        setAutoStatus({ kind: "error", message: result.error ?? "Couldn't save." });
        return false;
      } catch {
        dirty.current = true;
        setAutoStatus({ kind: "error", message: "Couldn't save. Check your connection." });
        return false;
      } finally {
        autoRunning.current = null;
      }
    })();
    autoRunning.current = job;
    return job;
  }, [autosave]);

  // After a Save / Test / Send: done means saved; refused (e.g. Send blocked) means
  // nothing was written, so autosave what was changed.
  useEffect(() => {
    if (pending) return;
    if (state.ok) dirty.current = false;
    else if (state.error && dirty.current) void autosaveNow();
  }, [pending, state, autosaveNow]);

  function cancelAutosaveTimer() {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = null;
  }

  function scheduleAutosave() {
    if (!autosave) return;
    dirty.current = true;
    cancelAutosaveTimer();
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null;
      void autosaveNow();
    }, AUTOSAVE_DELAY_MS);
  }

  // Save what's pending when the tab is hidden or the page is left; warn on close with unsaved changes.
  useEffect(() => {
    if (!autosave) return;
    const flush = () => {
      if (!autoTimer.current) return;
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
      void autosaveNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || autoRunning.current) event.preventDefault();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      flush();
    };
  }, [autosave, autosaveNow]);

  /** Opens the template editor for this campaign: saves first (a new campaign needs its id). */
  async function openTemplateEditor(href: (id: string) => string) {
    cancelAutosaveTimer();
    if (!idRef.current) dirty.current = true;
    setLeaving(true);
    await autosaveNow();
    const id = idRef.current;
    if (!id) {
      setLeaving(false);
      setAutoStatus((s) => (s.kind === "error" ? s : { kind: "error", message: "Add a subject or pick a template first." }));
      return;
    }
    router.push(href(id));
  }

  const current = data.designs.find((d) => d.value === design) ?? data.designs[0];
  const autoText = useMemo(() => (current ? htmlToPlainText(current.html) : ""), [current]);
  const textStale = !textTouched && current ? isTextVersionStale(textBody, initial.textBodyFor, current.html) : false;
  const hasMoreOptions =
    Boolean(initial.name && initial.name !== initial.subject) ||
    Boolean(initial.replyTo) ||
    initial.format === "text" ||
    Boolean(initial.textBody);

  const scheduledUtc = when ? zonedLocalToUtc(when, timeZone) : null;
  const scheduleOffset = scheduledUtc ? formatUtcOffset(scheduledUtc, timeZone) : null;

  function chooseDesign(value: string) {
    const next = data.designs.find((d) => d.value === value);
    // Suggest the design's subject / preview text unless the user has written their own.
    if (next?.subject && (!subject.trim() || subject === current?.subject)) setSubject(next.subject);
    if (next && (!previewText.trim() || previewText === current?.previewText)) setPreviewText(next.previewText);
    setDesign(value);
  }

  function refreshCount(next: string[]) {
    const request = ++latestCount.current;
    startCounting(async () => {
      const total = next.length ? await estimateRecipients(next) : 0;
      if (request === latestCount.current) setRecipients(total);
    });
  }

  function toggleList(id: string, checked: boolean) {
    const next = checked ? [...listIds, id] : listIds.filter((other) => other !== id);
    setListIds(next);
    refreshCount(next);
  }

  function openConfirm() {
    // Recount right before confirming: contacts may have unsubscribed meanwhile.
    if (listIds.length) refreshCount(listIds);
    confirmRef.current?.showModal();
  }

  // Submit through a transition so nothing typed is reset, and send the clicked button's intent.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || inFlight.current) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    const chosen = String(formData.get("intent") ?? "save");
    if (chosen === "schedule") {
      const check = checkSchedule(when, timeZone);
      if (!check.ok) return setClientError(check.error);
    }
    inFlight.current = true;
    cancelAutosaveTimer();
    setClientError(null);
    setIntent(chosen);
    confirmRef.current?.close();
    // Save the campaign autosave already created, never a second copy.
    const submit = () => {
      if (idRef.current) formData.set("campaignId", idRef.current);
      startTransition(() => formAction(formData));
    };
    const running = autoRunning.current;
    if (running) void running.then(submit, submit);
    else submit();
  }

  const busy = (name: string) => pending && intent === name;
  const error = clientError ?? state.error;
  const shownNotice = !state.ok && !state.error && notice ? NOTICES[notice] : null;
  const fieldError = (name: string) => state.fieldErrors?.[name]?.[0];
  const senderLabel = data.sender.email
    ? data.sender.name
      ? `${data.sender.name} <${data.sender.email}>`
      : data.sender.email
    : null;

  return (
    <form ref={formRef} onSubmit={handleSubmit} onChange={scheduleAutosave} className="grid items-start gap-6 xl:grid-cols-5">
      {campaignId === null ? <input type="hidden" name="startedNew" value="1" /> : null}
      <Card className="xl:col-span-3">
        <div className="space-y-6 p-5">
          {/* Subject */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <label htmlFor="subject" className="block text-sm font-medium text-slate-900">
                Subject
              </label>
              <PersonaliseSelect inputRef={subjectRef} fieldKeys={data.fieldKeys} aria-label="Insert personalisation into the subject" />
            </div>
            <Input
              ref={subjectRef}
              id="subject"
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
              autoFocus={!campaignId}
              placeholder="What's this email about?"
              aria-invalid={fieldError("subject") ? true : undefined}
            />
            {fieldError("subject") ? (
              <p className="text-xs text-red-600">{fieldError("subject")}</p>
            ) : (
              <PersonalisationExample text={subject} />
            )}
          </div>

          {/* Preview text (preheader) */}
          {format === "html" ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <label htmlFor="previewText" className="block text-sm font-medium text-slate-900">
                  Preview text <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <span className="flex items-center gap-3">
                  <span className={cn("text-xs tabular-nums", previewText.length > 150 ? "text-amber-600" : "text-slate-400")}>
                    {previewText.length}/{PREVIEW_TEXT_MAX}
                  </span>
                  <PersonaliseSelect inputRef={previewTextRef} fieldKeys={data.fieldKeys} aria-label="Insert personalisation into the preview text" />
                </span>
              </div>
              <Input
                ref={previewTextRef}
                id="previewText"
                name="previewText"
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                maxLength={PREVIEW_TEXT_MAX}
                placeholder="Shown next to the subject in the inbox"
                aria-invalid={fieldError("previewText") ? true : undefined}
              />
              {fieldError("previewText") ? (
                <p className="text-xs text-red-600">{fieldError("previewText")}</p>
              ) : (
                <>
                  <PersonalisationExample text={previewText} />
                  <p className="text-xs text-slate-500">Keep it short: 40 to 130 characters show best.</p>
                </>
              )}
            </div>
          ) : (
            <input type="hidden" name="previewText" value={previewText} />
          )}

          {/* Design */}
          <fieldset className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <legend className="text-sm font-medium text-slate-900">Template</legend>
              <span className="flex gap-4 text-sm">
                {current?.templateId ? (
                  <button
                    type="button"
                    disabled={leaving || pending}
                    onClick={() => {
                      const templateId = current.templateId;
                      if (templateId) void openTemplateEditor((id) => templateHrefForCampaign(templateId, id));
                    }}
                    className="font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-60"
                  >
                    {leaving ? "Opening..." : "Edit design"}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={leaving || pending}
                  onClick={() => void openTemplateEditor(newTemplateHrefForCampaign)}
                  className="font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-60"
                >
                  New template
                </button>
              </span>
            </div>
            <p className="text-xs text-slate-500">
              The email comes from the template. Edit design opens it; saving there brings the changes back to this campaign.
            </p>
            {fieldError("source") ? <p className="text-xs text-red-600">{fieldError("source")}</p> : null}
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
                <p className={cn("text-sm", fieldError("listIds") ? "text-red-600" : "text-slate-500")} aria-live="polite">
                  {fieldError("listIds") ??
                    (listIds.length === 0
                      ? "Choose at least one list."
                      : counting
                        ? "Counting..."
                        : `${people(recipients)} will get this email.`)}
                </p>
              </>
            )}
          </fieldset>

          {/* Sender (read-only: it comes from Settings) */}
          <p className={cn("text-sm", fieldError("sender") ? "text-red-600" : "text-slate-600")}>
            <span className="font-medium text-slate-900">From</span>{" "}
            {senderLabel ?? <span className="text-amber-700">not set yet</span>}{" "}
            <Link href="/settings" className="font-medium text-indigo-600 hover:text-indigo-500">
              Change in Settings
            </Link>
            {fieldError("sender") ? <span className="block text-xs">{fieldError("sender")}</span> : null}
          </p>

          {/* Advanced */}
          <details open={hasMoreOptions || Boolean(fieldError("replyTo") || fieldError("name") || fieldError("textBody"))} className="group rounded-lg border border-slate-200">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900">
              More options
            </summary>
            <div className="space-y-5 border-t border-slate-200 px-4 py-4">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="name" className="block text-sm font-medium text-slate-900">
                    Campaign name
                  </label>
                  <Input
                    id="name"
                    name="name"
                    defaultValue={initial.name && initial.name !== initial.subject ? initial.name : ""}
                    maxLength={200}
                    placeholder={displaySubject(subject) || "Same as the subject"}
                  />
                  <p className={cn("text-xs", fieldError("name") ? "text-red-600" : "text-slate-500")}>
                    {fieldError("name") ?? "Only you see this. Leave empty to use the subject."}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="replyTo" className="block text-sm font-medium text-slate-900">
                    Reply-to
                  </label>
                  <Input
                    id="replyTo"
                    name="replyTo"
                    type="email"
                    inputMode="email"
                    defaultValue={initial.replyTo}
                    maxLength={320}
                    placeholder={data.defaultReplyTo || data.sender.email || "you@example.com"}
                    aria-invalid={fieldError("replyTo") ? true : undefined}
                  />
                  <p className={cn("text-xs", fieldError("replyTo") ? "text-red-600" : "text-slate-500")}>
                    {fieldError("replyTo") ?? "Where replies go. Leave empty to use Settings."}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 sm:max-w-xs">
                <label htmlFor="format" className="block text-sm font-medium text-slate-900">
                  Format
                </label>
                <Select id="format" name="format" value={format} onChange={(e) => setFormat(e.target.value === "text" ? "text" : "html")}>
                  <option value="html">HTML email</option>
                  <option value="text">Plain text only</option>
                </Select>
                {format === "text" ? (
                  <p className="text-xs text-slate-500">Sent as plain text: no images or styling, and opens can&apos;t be tracked.</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <label htmlFor="textBody" className="block text-sm font-medium text-slate-900">
                    {format === "text" ? "Email text" : "Plain-text version"}
                  </label>
                  {textBody ? (
                    <button
                      type="button"
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                      onClick={() => {
                        setTextBody("");
                        setTextTouched(true);
                        scheduleAutosave();
                      }}
                    >
                      Use automatic text
                    </button>
                  ) : null}
                </div>
                {textStale ? (
                  <Alert tone="warning">The template changed after this text was written. Check it still matches.</Alert>
                ) : null}
                <Textarea
                  id="textBody"
                  name="textBody"
                  rows={8}
                  value={textBody}
                  onChange={(e) => {
                    setTextBody(e.target.value);
                    setTextTouched(true);
                  }}
                  placeholder={autoText}
                  className="font-mono text-xs"
                  aria-invalid={fieldError("textBody") ? true : undefined}
                />
                <p className={cn("text-xs", fieldError("textBody") ? "text-red-600" : "text-slate-500")}>
                  {fieldError("textBody") ??
                    "Leave empty to make it from the template automatically. The unsubscribe link is always added."}
                </p>
              </div>
            </div>
          </details>

          <PersonalisationFields value={data.fieldKeys}>{typeOptions}</PersonalisationFields>
        </div>

        {/* Actions */}
        <div className="space-y-3 border-t border-slate-200 bg-slate-50/60 px-5 py-4">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {state.warning ? <Alert tone="warning">{state.warning}</Alert> : null}
          {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}
          {shownNotice ? <Alert tone={shownNotice.tone}>{shownNotice.text}</Alert> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={pending} onClick={openConfirm}>
              {busy("send") ? "Sending..." : "Send now"}
            </Button>
            <Button type="submit" name="intent" value="save" variant="secondary" disabled={pending}>
              {busy("save") ? "Saving..." : "Save draft"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setShowSchedule((v) => !v)}>
              {initial.scheduledLocal ? "Change time" : "Schedule"}
            </Button>
            {autosave ? <AutosaveIndicator status={autoStatus} /> : null}
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
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-56">
                  <Input
                    name="when"
                    type="datetime-local"
                    step={900}
                    aria-label="Send at"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    aria-invalid={fieldError("when") ? true : undefined}
                  />
                </div>
                <div className="w-60">
                  <Select name="timeZone" aria-label="Timezone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                    {data.timeZones.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                </div>
                {scheduleOffset ? <span className="text-xs tabular-nums text-slate-500">{scheduleOffset}</span> : null}
                <Button type="submit" name="intent" value="schedule" variant="secondary" disabled={pending}>
                  {busy("schedule") ? "Scheduling..." : initial.scheduledLocal ? "Reschedule" : "Schedule"}
                </Button>
              </div>
              {fieldError("when") ? <p className="text-xs text-red-600">{fieldError("when")}</p> : null}
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
              {listIds.length ? (counting ? "Counting people..." : `Send to ${people(recipients)} now?`) : "Send now?"}
            </h2>
            <p className="text-sm text-slate-600">
              Only subscribed contacts get it. This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" autoFocus onClick={() => confirmRef.current?.close()}>
                Cancel
              </Button>
              <Button type="submit" name="intent" value="send" disabled={pending || counting}>
                Send
              </Button>
            </div>
          </div>
        </dialog>
      </Card>

      <aside aria-label="Preview" className="xl:sticky xl:top-6 xl:col-span-2">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-2.5 text-sm">
            {/* As an example contact sees it (merge tags filled in). */}
            <p className="truncate font-medium text-slate-900">
              {(personalisationExample(subject)?.filled ?? subject.trim()) || <span className="text-slate-400">No subject yet</span>}
            </p>
            {format === "html" && previewText.trim() ? (
              <p className="truncate text-xs text-slate-500">{personalisationExample(previewText)?.filled ?? previewText}</p>
            ) : null}
          </div>
          {format === "text" ? (
            <pre className="h-[620px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs text-slate-800">{textBody.trim() || autoText}</pre>
          ) : current ? (
            <EmailPreview html={current.html} height={620} />
          ) : null}
        </Card>
      </aside>
    </form>
  );
}

/** "Saving... / Saved / Couldn't save" next to the buttons. */
function AutosaveIndicator({ status }: { status: AutosaveStatus }) {
  if (status.kind === "saving") {
    return (
      <span className="text-sm text-slate-500" role="status">
        Saving...
      </span>
    );
  }
  if (status.kind === "saved") {
    return (
      <span className="text-sm text-emerald-700" role="status">
        Saved {status.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
    );
  }
  if (status.kind === "error") {
    return (
      <span className="text-sm text-red-600" role="status" title={status.message}>
        Couldn&apos;t save: {status.message}
      </span>
    );
  }
  return <span className="text-sm text-slate-400">Saves automatically</span>;
}
