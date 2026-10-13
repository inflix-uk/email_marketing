"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { EmailEditor } from "@/components/email-editor";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Field, Input, Select } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import type { AutomationDoc, AutomationTrigger } from "@/db/schema";
import {
  DELAY_UNITS,
  MAX_STEPS,
  delayToMinutes,
  describeStepTiming,
  splitDelay,
  type DelayUnit,
} from "@/lib/automations/logic";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import { saveAutomation, type ActionState } from "../actions";
import { BLANK_STEP } from "../_lib/examples";
import type { TriggerOptions } from "../_lib/queries";

export interface StepDefaults {
  id: string;
  delayMinutes: number;
  subject: string;
  previewText: string;
  html: string;
  design: string | null;
}

export interface AutomationDefaults {
  name: string;
  trigger: AutomationTrigger | null;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  steps: StepDefaults[];
}

/** What one email of the series has done so far. */
export interface StepNumbers {
  sent: number;
  opened: number;
  clicked: number;
  failed: number;
  /** People whose next email is this one. */
  waiting: number;
}

interface StepState {
  id: string;
  delayValue: string;
  delayUnit: DelayUnit;
  subject: string;
  previewText: string;
  /** Saved content: posted as-is until the step's editor has been opened. */
  html: string;
  design: string | null;
}

type TriggerType = AutomationTrigger["type"];

const TRIGGER_TYPES: { value: TriggerType; label: string; hint: string }[] = [
  { value: "list_joined", label: "Joins a list", hint: "Someone is added to a list." },
  { value: "form_submitted", label: "Submits a form", hint: "Someone signs up through a sign-up form." },
  { value: "tag_added", label: "Gets a tag", hint: "A tag is added to a contact." },
];

/** Step ids only need to be unique within the automation (letters, digits, dashes). */
function newStepId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function toStepState(step: StepDefaults): StepState {
  const { value, unit } = splitDelay(step.delayMinutes);
  return {
    id: step.id,
    delayValue: String(value),
    delayUnit: unit,
    subject: step.subject,
    previewText: step.previewText,
    html: step.html,
    design: step.design,
  };
}

/** "subject-<stepId>" -> "<stepId>" for every step-level field error. */
function stepIdsWithErrors(fieldErrors: ActionState["fieldErrors"], steps: StepState[]): string[] {
  const keys = Object.keys(fieldErrors ?? {});
  return steps.filter((s) => keys.some((k) => k.endsWith(`-${s.id}`))).map((s) => s.id);
}

/**
 * The automation editor: details, trigger, sender and the series of emails.
 * Used to create (automationId = null) and to edit an automation.
 */
export function AutomationForm({
  automationId,
  status,
  defaults,
  options,
  stepStats = {},
}: {
  automationId: string | null;
  status: AutomationDoc["status"] | null;
  defaults: AutomationDefaults;
  options: TriggerOptions;
  stepStats?: Record<string, StepNumbers>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // Bumped on every edit, so a save only clears "dirty" if nothing changed meanwhile.
  const revision = useRef(0);
  const [dirty, setDirty] = useState(false);

  const [steps, setSteps] = useState<StepState[]>(() => defaults.steps.map(toStepState));
  // A lone email starts expanded; a longer series starts as an overview.
  const initiallyOpen = defaults.steps.length === 1 ? [defaults.steps[0].id] : [];
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen));
  // Editors are heavy (live preview): mounted on first open, then kept so edits survive collapsing.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen));

  const [triggerType, setTriggerType] = useState<TriggerType>(defaults.trigger?.type ?? "list_joined");
  const [listId, setListId] = useState(defaults.trigger?.type === "list_joined" ? defaults.trigger.listId : "");
  const [formId, setFormId] = useState(defaults.trigger?.type === "form_submitted" ? defaults.trigger.formId : "");
  const [tag, setTag] = useState(defaults.trigger?.type === "tag_added" ? defaults.trigger.tag : "");

  function reveal(ids: string[]) {
    if (ids.length === 0) return;
    setOpen((prev) => new Set([...prev, ...ids]));
    setMounted((prev) => new Set([...prev, ...ids]));
  }

  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const submitted = revision.current;
    const result = await saveAutomation(automationId, prev, formData);
    if (result.ok && revision.current === submitted) setDirty(false);
    // Open the emails that need fixing.
    reveal(stepIdsWithErrors(result.fieldErrors, steps));
    return result;
  }, {});

  function markDirty() {
    revision.current += 1;
    setDirty(true);
  }

  // Submit manually: an automatic form reset would wipe edits when validation fails.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    formData.set("intent", submitter?.value === "activate" ? "activate" : "save");
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
    const target = first ? document.getElementById(first === "triggerType" ? "trigger" : first) : null;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target instanceof HTMLInputElement) target.focus({ preventScroll: true });
  }, [state]);

  // --- Steps -------------------------------------------------------------------

  function updateStep(id: string, patch: Partial<StepState>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addStep() {
    const id = newStepId();
    setSteps((prev) => [
      ...prev,
      {
        id,
        delayValue: prev.length === 0 ? "0" : "1",
        delayUnit: prev.length === 0 ? "minutes" : "days",
        subject: "",
        previewText: "",
        html: BLANK_STEP.html,
        design: BLANK_STEP.design,
      },
    ]);
    reveal([id]);
    markDirty();
  }

  function removeStep(id: string) {
    setSteps((prev) => prev.filter((s) => s.id !== id));
    markDirty();
  }

  function moveStep(index: number, by: -1 | 1) {
    setSteps((prev) => {
      const target = index + by;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    markDirty();
  }

  function toggleStep(id: string) {
    if (open.has(id)) setOpen((prev) => new Set([...prev].filter((x) => x !== id)));
    else reveal([id]);
  }

  const errors = state.fieldErrors ?? {};
  const isNew = automationId === null;

  return (
    <form ref={formRef} onSubmit={handleSubmit} onChange={markDirty} className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <Field label="Automation name" htmlFor="name" hint="Internal - recipients don't see this." error={errors.name}>
                <Input
                  id="name"
                  name="name"
                  defaultValue={defaults.name}
                  required
                  maxLength={200}
                  autoFocus={isNew}
                  placeholder="e.g. Welcome series"
                  aria-invalid={errors.name ? true : undefined}
                />
              </Field>
            </CardBody>
          </Card>

          <Card id="trigger" className="scroll-mt-6">
            <CardHeader title="Trigger" description="The series starts when someone..." />
            <CardBody className="space-y-4">
              <fieldset>
                <legend className="sr-only">What starts this automation</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {TRIGGER_TYPES.map((t) => {
                    const checked = t.value === triggerType;
                    return (
                      <label
                        key={t.value}
                        className={cn(
                          "flex cursor-pointer flex-col rounded-lg border p-3 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600",
                          checked
                            ? "border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600"
                            : "border-slate-200 bg-white hover:border-slate-300",
                        )}
                      >
                        <input
                          type="radio"
                          name="triggerType"
                          value={t.value}
                          checked={checked}
                          onChange={() => setTriggerType(t.value)}
                          className="sr-only"
                        />
                        <span className="text-sm font-medium text-slate-900">{t.label}</span>
                        <span className="mt-0.5 text-xs text-slate-500">{t.hint}</span>
                      </label>
                    );
                  })}
                </div>
                {errors.triggerType ? <p className="mt-2 text-xs text-red-600">{errors.triggerType[0]}</p> : null}
              </fieldset>

              {triggerType === "list_joined" ? (
                <Field
                  label="List"
                  htmlFor="listId"
                  error={errors.listId}
                  hint={
                    options.lists.length === 0 ? (
                      <>
                        You have no lists yet.{" "}
                        <Link href="/lists" className="font-medium text-indigo-600 hover:text-indigo-500">
                          Create a list
                        </Link>{" "}
                        first.
                      </>
                    ) : (
                      "Starts for each person added to this list one at a time (sign-up form, contact page, API)."
                    )
                  }
                >
                  <Select
                    id="listId"
                    name="listId"
                    value={listId}
                    onChange={(e) => setListId(e.target.value)}
                    aria-invalid={errors.listId ? true : undefined}
                  >
                    <option value="">Choose a list...</option>
                    {listId && !options.lists.some((l) => l.id === listId) ? (
                      <option value={listId}>(deleted list)</option>
                    ) : null}
                    {options.lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              {triggerType === "form_submitted" ? (
                <Field
                  label="Sign-up form"
                  htmlFor="formId"
                  error={errors.formId}
                  hint={
                    options.forms.length === 0 ? (
                      <>
                        You have no sign-up forms yet.{" "}
                        <Link href="/forms" className="font-medium text-indigo-600 hover:text-indigo-500">
                          Create a form
                        </Link>{" "}
                        first, or start from a list or a tag instead.
                      </>
                    ) : (
                      "Starts for each new subscriber who signs up through this form."
                    )
                  }
                >
                  <Select
                    id="formId"
                    name="formId"
                    value={formId}
                    onChange={(e) => setFormId(e.target.value)}
                    aria-invalid={errors.formId ? true : undefined}
                  >
                    <option value="">{options.forms.length === 0 ? "No forms yet" : "Choose a form..."}</option>
                    {formId && !options.forms.some((f) => f.id === formId) ? (
                      <option value={formId}>(deleted form)</option>
                    ) : null}
                    {options.forms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              {triggerType === "tag_added" ? (
                <Field
                  label="Tag"
                  htmlFor="tag"
                  error={errors.tag}
                  hint="Starts when this tag is added to a contact. Tags are not case-sensitive."
                >
                  <Input
                    id="tag"
                    name="tag"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    maxLength={50}
                    placeholder="e.g. customer"
                    autoCapitalize="off"
                    aria-invalid={errors.tag ? true : undefined}
                  />
                </Field>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader title="Sender" description="Use an address on a domain you've verified with your email provider." />
          <CardBody className="space-y-4">
            <Field label="From name" htmlFor="fromName" error={errors.fromName}>
              <Input
                id="fromName"
                name="fromName"
                defaultValue={defaults.fromName}
                maxLength={100}
                placeholder="Acme"
                aria-invalid={errors.fromName ? true : undefined}
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
      </div>

      <section aria-labelledby="emails-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="emails-heading" className="text-base font-semibold text-slate-900">
              Emails
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Sent one after another to each person. Every wait counts from the previous email.
            </p>
          </div>
          <span className="text-xs text-slate-500">
            {steps.length} of {MAX_STEPS}
          </span>
        </div>

        {steps.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-slate-200 px-6 py-10 text-center">
            <p className="text-sm font-semibold text-slate-900">No emails yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Add the first email of the series. One email sent immediately makes a welcome email.
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {steps.map((step, index) => (
              <StepCard
                key={step.id}
                step={step}
                index={index}
                count={steps.length}
                isOpen={open.has(step.id)}
                editorMounted={mounted.has(step.id)}
                numbers={stepStats[step.id]}
                errors={errors}
                onToggle={() => toggleStep(step.id)}
                onChange={(patch) => updateStep(step.id, patch)}
                onMove={(by) => moveStep(index, by)}
                onRemove={() => removeStep(step.id)}
                onEdit={markDirty}
              />
            ))}
          </ol>
        )}

        <Button type="button" variant="secondary" onClick={addStep} disabled={steps.length >= MAX_STEPS}>
          + Add {steps.length === 0 ? "an email" : "another email"}
        </Button>
      </section>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.warning && !dirty ? <Alert tone="warning">{state.warning}</Alert> : null}

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-white/95 px-4 py-3 shadow-md ring-1 ring-slate-200 backdrop-blur">
        <SaveStatus pending={pending} dirty={dirty} state={state} isNew={isNew} />
        <div className="flex flex-wrap items-center gap-2">
          {isNew ? (
            <>
              <ButtonLink href="/automations" variant="secondary">
                Cancel
              </ButtonLink>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating..." : "Create automation"}
              </Button>
            </>
          ) : (
            <>
              <Button type="submit" name="intent" value="save" variant={status === "active" ? "primary" : "secondary"} disabled={pending}>
                {pending ? "Saving..." : "Save changes"}
              </Button>
              {status !== "active" ? (
                <Button type="submit" name="intent" value="activate" disabled={pending}>
                  {status === "paused" ? "Save & resume" : "Save & activate"}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </form>
  );
}

function StepCard({
  step,
  index,
  count,
  isOpen,
  editorMounted,
  numbers,
  errors,
  onToggle,
  onChange,
  onMove,
  onRemove,
  onEdit,
}: {
  step: StepState;
  index: number;
  count: number;
  isOpen: boolean;
  editorMounted: boolean;
  numbers: StepNumbers | undefined;
  errors: Record<string, string[] | undefined>;
  onToggle: () => void;
  onChange: (patch: Partial<StepState>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const field = (name: string) => `${name}-${step.id}`;
  const timing = describeStepTiming(delayToMinutes(Number(step.delayValue), step.delayUnit), index);
  const hasError = Object.keys(errors).some((k) => k.endsWith(`-${step.id}`));
  const bodyId = field("body");

  return (
    <li className={cn("rounded-lg bg-white shadow-sm ring-1", hasError ? "ring-red-300" : "ring-slate-200")}>
      <input type="hidden" name="stepIds" value={step.id} />

      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700"
        >
          {index + 1}
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={bodyId}
          className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <span className="block truncate text-sm font-medium text-slate-900">
            <span className="sr-only">Email {index + 1}: </span>
            {step.subject.trim() || <span className="italic text-slate-400">No subject yet</span>}
          </span>
          <span className="block truncate text-xs text-slate-500">{timing}</span>
        </button>

        {numbers ? <StepStats numbers={numbers} /> : null}

        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={`Move email ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>
            <path d="M10 15V5M5 10l5-5 5 5" />
          </IconButton>
          <IconButton label={`Move email ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
            <path d="M10 5v10M5 10l5 5 5-5" />
          </IconButton>
          <IconButton label={`Remove email ${index + 1}`} onClick={onRemove} danger>
            <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" />
          </IconButton>
          <Button type="button" variant="secondary" size="sm" onClick={onToggle}>
            {isOpen ? "Close" : "Edit"}
          </Button>
        </div>
      </div>

      {/* Kept in the DOM while collapsed, so every email is submitted with the form. */}
      <div id={bodyId} hidden={!isOpen} className="space-y-4 border-t border-slate-200 px-4 py-4">
        <Field
          label="When to send"
          htmlFor={field("delay")}
          error={errors[field("delay")]}
          hint={index === 0 ? "0 sends it straight away, as soon as the trigger happens." : "Counted from the moment the previous email was sent."}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={field("delay")}
              name={field("delayValue")}
              value={step.delayValue}
              onChange={(e) => onChange({ delayValue: e.target.value.replace(/[^\d]/g, "").slice(0, 5) })}
              inputMode="numeric"
              className="w-20"
              aria-invalid={errors[field("delay")] ? true : undefined}
            />
            <Select
              name={field("delayUnit")}
              value={step.delayUnit}
              onChange={(e) => onChange({ delayUnit: e.target.value as DelayUnit })}
              aria-label="Delay unit"
              className="w-32"
            >
              {DELAY_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
            <span className="text-sm text-slate-600">after {index === 0 ? "the trigger" : "the previous email"}</span>
          </div>
        </Field>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field
            label="Subject line"
            htmlFor={field("subject")}
            error={errors[field("subject")]}
            hint={
              <>
                Merge tags work here, e.g. <code className="font-mono">{"{{first_name | there}}"}</code>.
              </>
            }
          >
            <Input
              id={field("subject")}
              name={field("subject")}
              value={step.subject}
              onChange={(e) => onChange({ subject: e.target.value })}
              maxLength={300}
              placeholder="What's this email about?"
              aria-invalid={errors[field("subject")] ? true : undefined}
            />
          </Field>
          <Field
            label="Preview text"
            htmlFor={field("previewText")}
            error={errors[field("previewText")]}
            hint="Optional. Shown after the subject in most inboxes."
          >
            <Input
              id={field("previewText")}
              name={field("previewText")}
              value={step.previewText}
              onChange={(e) => onChange({ previewText: e.target.value })}
              maxLength={300}
            />
          </Field>
        </div>

        <div id={field("html")} className="scroll-mt-6 space-y-1.5">
          <p className="text-sm font-medium text-slate-700">Content</p>
          {errors[field("html")] ? <Alert tone="error">{errors[field("html")]?.[0]}</Alert> : null}
          {editorMounted ? (
            <EmailEditor
              name={field("html")}
              designName={field("design")}
              defaultValue={step.html}
              defaultDesign={step.design}
              previewText={step.previewText}
              minHeight={480}
              onChange={onEdit}
            />
          ) : (
            <>
              <input type="hidden" name={field("html")} value={step.html} />
              <input type="hidden" name={field("design")} value={step.design ?? ""} />
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function StepStats({ numbers }: { numbers: StepNumbers }) {
  const items: { label: string; value: ReactNode; title?: string }[] = [
    { label: "sent", value: formatNumber(numbers.sent) },
    { label: "opened", value: formatPercent(numbers.opened, numbers.sent), title: `${formatNumber(numbers.opened)} people opened it` },
    { label: "clicked", value: formatPercent(numbers.clicked, numbers.sent), title: `${formatNumber(numbers.clicked)} people clicked a link` },
  ];
  if (numbers.waiting > 0) items.push({ label: "waiting", value: formatNumber(numbers.waiting), title: "People whose next email is this one" });
  if (numbers.failed > 0) items.push({ label: "failed", value: formatNumber(numbers.failed) });
  return (
    <dl className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1" title={item.title}>
          <dd className="font-semibold tabular-nums text-slate-800">{item.value}</dd>
          <dt>{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

function IconButton({
  label,
  disabled,
  danger,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:pointer-events-none disabled:opacity-30",
        danger ? "hover:bg-red-50 hover:text-red-700" : "hover:bg-slate-100 hover:text-slate-900",
      )}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function SaveStatus({ pending, dirty, state, isNew }: { pending: boolean; dirty: boolean; state: ActionState; isNew: boolean }) {
  let content: ReactNode;
  if (pending) {
    content = <span className="text-slate-500">Saving...</span>;
  } else if (state.error) {
    content = <span className="text-red-600">Not saved - see the message above.</span>;
  } else if (isNew) {
    content = <span className="text-slate-500">It is created as a draft. Nothing is sent until you activate it.</span>;
  } else if (dirty) {
    content = (
      <span className="flex items-center gap-2 text-amber-700">
        <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" />
        Unsaved changes
      </span>
    );
  } else if (state.ok && state.message) {
    content = <span className="text-emerald-700">{state.message}</span>;
  } else {
    content = <span className="text-slate-500">All changes saved</span>;
  }
  return (
    <p className="min-w-0 text-sm" aria-live="polite">
      {content}
    </p>
  );
}
