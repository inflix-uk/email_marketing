"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { EmailEditor } from "@/components/email-editor";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { renderMergeTags, SAMPLE_CONTACT } from "@/lib/render";
import { saveCampaign, type SaveState } from "../actions";
import { AB_TEST_DEFAULTS, AB_TEST_LIMITS } from "../_lib/ab-test";
import type { ListOption } from "../_lib/queries";
import { AudiencePicker, type SegmentOption } from "./audience-picker";
import { useEditorState } from "./editor-state";

export interface EditorDefaults {
  name: string;
  subject: string;
  previewText: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  html: string;
  /** Visual-editor design JSON, or null when the HTML was written by hand. */
  design: string | null;
  /** null = no A/B test. */
  abTest: { subjectB: string; testPercent: number; waitHours: number } | null;
}

// Where to send focus when the server rejects a field.
const FIELD_TARGETS: Record<string, string> = {
  name: "name",
  subject: "subject",
  previewText: "previewText",
  fromName: "fromName",
  fromEmail: "fromEmail",
  replyTo: "replyTo",
  listIds: "audience",
  segmentIds: "audience",
  html: "content",
  design: "content",
};

/**
 * The campaign's one edit form. It uses `display: contents` so its sections
 * sit directly in the page grid next to the (separate) review panel.
 */
export function EditorForm({
  campaignId,
  defaults,
  lists,
  segments,
  selectedListIds,
  selectedSegmentIds,
  recipientCount,
}: {
  campaignId: string;
  defaults: EditorDefaults;
  lists: ListOption[];
  segments: SegmentOption[];
  selectedListIds: string[];
  selectedSegmentIds: string[];
  recipientCount: number;
}) {
  const { dirty, setDirty } = useEditorState();
  const formRef = useRef<HTMLFormElement>(null);
  // Bumped on every edit, so a save only clears "dirty" if nothing changed meanwhile.
  const revision = useRef(0);

  const [state, formAction, pending] = useActionState<SaveState, FormData>(async (prev, formData) => {
    const submitted = revision.current;
    const result = await saveCampaign(campaignId, prev, formData);
    if (result.ok && revision.current === submitted) setDirty(false);
    return result;
  }, {});

  // Mirrored in state for the inbox preview.
  const [fromName, setFromName] = useState(defaults.fromName);
  const [subject, setSubject] = useState(defaults.subject);
  const [previewText, setPreviewText] = useState(defaults.previewText);

  function markDirty() {
    revision.current += 1;
    setDirty(true);
  }

  // Submit manually: an automatic form reset would wipe edits when validation fails.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Bring the first invalid field into view.
  useEffect(() => {
    const first = Object.keys(state.fieldErrors ?? {})[0];
    const target = first ? document.getElementById(FIELD_TARGETS[first] ?? first) : null;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target instanceof HTMLInputElement) target.focus({ preventScroll: true });
  }, [state]);

  const errors = state.fieldErrors ?? {};

  return (
    <form ref={formRef} onSubmit={handleSubmit} onChange={markDirty} className="contents">
      <div className="space-y-6 lg:col-span-2">
        <Card id="details" className="scroll-mt-6">
          <CardHeader title="Details" />
          <CardBody className="space-y-4">
            <Field label="Campaign name" htmlFor="name" hint="Internal - recipients don't see this." error={errors.name}>
              <Input id="name" name="name" defaultValue={defaults.name} required maxLength={200} />
            </Field>
            <Field
              label="Subject line"
              htmlFor="subject"
              hint={
                <>
                  Merge tags work here, e.g. <code className="font-mono">{"{{first_name}}"}</code> or{" "}
                  <code className="font-mono">{"{{first_name | there}}"}</code> with a fallback.
                </>
              }
              error={errors.subject}
            >
              <Input
                id="subject"
                name="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={300}
                placeholder="What's this email about?"
              />
            </Field>
            <Field
              label="Preview text"
              htmlFor="previewText"
              hint="Optional. Shown after the subject in most inboxes - around 40 to 90 characters works well."
              error={errors.previewText}
            >
              <Input
                id="previewText"
                name="previewText"
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                maxLength={300}
              />
            </Field>
            <InboxPreview fromName={fromName} subject={subject} previewText={previewText} />
            <AbTestFields defaults={defaults.abTest} errors={errors} />
          </CardBody>
        </Card>

        <Card id="sender" className="scroll-mt-6">
          <CardHeader title="Sender" description="Use an address on a domain you've verified with your email provider." />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From name" htmlFor="fromName" error={errors.fromName}>
                <Input
                  id="fromName"
                  name="fromName"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  maxLength={100}
                  placeholder="Acme Newsletter"
                />
              </Field>
              <Field label="From email" htmlFor="fromEmail" error={errors.fromEmail}>
                <Input
                  id="fromEmail"
                  name="fromEmail"
                  type="email"
                  defaultValue={defaults.fromEmail}
                  placeholder="hello@yourdomain.com"
                  aria-invalid={errors.fromEmail ? true : undefined}
                />
              </Field>
            </div>
            <Field
              label="Reply-to email"
              htmlFor="replyTo"
              hint="Optional. Where replies go, if not to the from address."
              error={errors.replyTo}
            >
              <Input
                id="replyTo"
                name="replyTo"
                type="email"
                defaultValue={defaults.replyTo}
                placeholder="support@yourdomain.com"
                aria-invalid={errors.replyTo ? true : undefined}
              />
            </Field>
          </CardBody>
        </Card>

        <AudiencePicker
          lists={lists}
          segments={segments}
          initialLists={selectedListIds}
          initialSegments={selectedSegmentIds}
          initialCount={recipientCount}
          error={errors.listIds?.[0] ?? errors.segmentIds?.[0]}
          onEdit={markDirty}
        />
      </div>

      <Card id="content" className="scroll-mt-6 lg:col-span-3">
        <CardHeader
          title="Content"
          description="Design the email or edit its HTML. The preview uses sample data for merge tags."
        />
        <CardBody>
          {errors.html || errors.design ? (
            <Alert tone="error" className="mb-4">
              {(errors.html ?? errors.design)?.[0]}
            </Alert>
          ) : null}
          <EmailEditor
            name="html"
            defaultValue={defaults.html}
            designName="design"
            defaultDesign={defaults.design}
            previewText={previewText}
            minHeight={560}
            onChange={markDirty}
          />
        </CardBody>
      </Card>

      {state.warning && !dirty ? (
        <Alert tone="warning" className="lg:col-span-3">
          {state.warning}
        </Alert>
      ) : null}

      <div className="sticky bottom-0 z-10 flex items-center justify-between gap-4 rounded-lg bg-white/95 px-4 py-3 shadow-md ring-1 ring-slate-200 backdrop-blur lg:col-span-3">
        <SaveStatus pending={pending} dirty={dirty} state={state} />
        <div className="flex items-center gap-3">
          <kbd className="hidden rounded border border-slate-200 px-1.5 py-0.5 font-sans text-xs text-slate-400 sm:inline">
            Ctrl + S
          </kbd>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function SaveStatus({ pending, dirty, state }: { pending: boolean; dirty: boolean; state: SaveState }) {
  let content: ReactNode;
  if (pending) {
    content = <span className="text-slate-500">Saving...</span>;
  } else if (state.error) {
    content = <span className="text-red-600">{state.error}</span>;
  } else if (dirty) {
    content = (
      <span className="flex items-center gap-2 text-amber-700">
        <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" />
        Unsaved changes
      </span>
    );
  } else if (state.ok && state.savedAt) {
    const time = new Date(state.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    content = <span className="text-emerald-700">Saved at {time}</span>;
  } else {
    content = <span className="text-slate-500">All changes saved</span>;
  }
  return (
    <p className="min-w-0 text-sm" aria-live="polite">
      {content}
    </p>
  );
}

/** Toggle + settings for an A/B test of the subject line (submitted as abEnabled, abSubjectB, ...). */
function AbTestFields({
  defaults,
  errors,
}: {
  defaults: EditorDefaults["abTest"];
  errors: Record<string, string[] | undefined>;
}) {
  const [enabled, setEnabled] = useState(defaults !== null);
  // Kept in state so switching the test off and on again doesn't lose what was typed.
  const [subjectB, setSubjectB] = useState(defaults?.subjectB ?? "");
  const [testPercent, setTestPercent] = useState(String(defaults?.testPercent ?? AB_TEST_DEFAULTS.testPercent));
  const [waitHours, setWaitHours] = useState(String(defaults?.waitHours ?? AB_TEST_DEFAULTS.waitHours));

  return (
    <div className="rounded-md ring-1 ring-inset ring-slate-200">
      {/* Tells the save action these fields were on the form. */}
      <input type="hidden" name="abForm" value="1" />
      <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
        <input
          type="checkbox"
          name="abEnabled"
          value="1"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          aria-controls="ab-test-fields"
          aria-expanded={enabled}
          className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-900">A/B test the subject line</span>
          <span className="mt-0.5 block text-xs text-slate-500">
            Part of your audience gets subject A or subject B; after the wait, the one with the better open rate goes
            to everyone else.
          </span>
        </span>
      </label>
      {enabled ? (
        <div id="ab-test-fields" className="space-y-4 border-t border-slate-200 px-4 py-4">
          <Field
            label="Subject B"
            htmlFor="abSubjectB"
            hint="Subject A is the subject line above."
            error={errors.abSubjectB}
          >
            <Input
              id="abSubjectB"
              name="abSubjectB"
              value={subjectB}
              onChange={(e) => setSubjectB(e.target.value)}
              maxLength={300}
              placeholder="A different way to say it"
              aria-invalid={errors.abSubjectB ? true : undefined}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Test size (%)"
              htmlFor="abTestPercent"
              hint="Share of recipients in the test, split evenly between A and B."
              error={errors.abTestPercent}
            >
              <Input
                id="abTestPercent"
                name="abTestPercent"
                type="number"
                inputMode="numeric"
                min={AB_TEST_LIMITS.testPercent.min}
                max={AB_TEST_LIMITS.testPercent.max}
                step={1}
                value={testPercent}
                onChange={(e) => setTestPercent(e.target.value)}
                aria-invalid={errors.abTestPercent ? true : undefined}
              />
            </Field>
            <Field
              label="Wait time (hours)"
              htmlFor="abWaitHours"
              hint="How long to collect opens before picking the winner."
              error={errors.abWaitHours}
            >
              <Input
                id="abWaitHours"
                name="abWaitHours"
                type="number"
                inputMode="numeric"
                min={AB_TEST_LIMITS.waitHours.min}
                max={AB_TEST_LIMITS.waitHours.max}
                step={1}
                value={waitHours}
                onChange={(e) => setWaitHours(e.target.value)}
                aria-invalid={errors.abWaitHours ? true : undefined}
              />
            </Field>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** How the email will look in an inbox list, with merge tags filled in. */
function InboxPreview({ fromName, subject, previewText }: { fromName: string; subject: string; previewText: string }) {
  const sample = { contact: SAMPLE_CONTACT, unsubscribeUrl: "" };
  const renderedSubject = renderMergeTags(subject, sample).trim();
  const renderedPreview = renderMergeTags(previewText, sample).trim();
  const sender = fromName.trim() || "Sender name";

  return (
    <div className="rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
      <p className="mb-2 text-xs font-medium text-slate-500">Inbox preview</p>
      <div className="flex items-start gap-3 rounded-md bg-white px-3 py-2.5 shadow-sm">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700"
        >
          {sender.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{sender}</p>
          <p className="truncate text-sm">
            <span className={renderedSubject ? "font-medium text-slate-800" : "italic text-slate-400"}>
              {renderedSubject || "No subject"}
            </span>
            {renderedPreview ? <span className="text-slate-500"> — {renderedPreview}</span> : null}
          </p>
        </div>
      </div>
    </div>
  );
}
