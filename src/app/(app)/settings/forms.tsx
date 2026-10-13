"use client";

import { startTransition, useActionState, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import {
  saveAccount,
  saveDeliverability,
  saveEmailProvider,
  saveSender,
  saveSending,
  sendTestEmail,
  type SettingsFormState,
} from "./actions";
import { detectProvider, detectWebhookProvider, PROVIDERS, WEBHOOK_PROVIDERS } from "./providers";

type Action = (prev: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;

/**
 * useActionState, submitted through a transition rather than <form action>:
 * React resets uncontrolled inputs after a form action, which would wipe what
 * was typed (e.g. after "Test connection" or a validation error).
 */
function useSettingsForm(action: Action) {
  const [state, dispatch, pending] = useActionState(action, {});
  // Which submit button was used (its value), for the pending label.
  const [intent, setIntent] = useState<string | null>(null);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(e.currentTarget, submitter);
    setIntent(submitter?.getAttribute("value") ?? null);
    startTransition(() => dispatch(formData));
  }
  return { state, pending, intent, onSubmit, errors: state.fieldErrors ?? {} };
}

function Result({ state, pending }: { state: SettingsFormState; pending: boolean }) {
  if (pending) return null;
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-red-600 break-words">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="text-sm text-emerald-700 break-words">
        {state.ok}
      </p>
    );
  }
  return null;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">{children}</div>;
}

// ---------------------------------------------------------------------------
// Email provider
// ---------------------------------------------------------------------------

export interface SmtpFormValues {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Whether a password is saved (the password itself never reaches the browser). */
  hasPassword: boolean;
}

export function EmailProviderForm({ initial }: { initial: SmtpFormValues }) {
  const { state, pending, intent, onSubmit, errors } = useSettingsForm(saveEmailProvider);

  return (
    <form onSubmit={onSubmit} className="space-y-4" autoComplete="off">
      {/* Re-mount after a save so the fields show what is now stored. */}
      <SmtpFields key={state.savedAt ?? 0} initial={initial} errors={errors} />
      <Actions>
        <Button type="submit" name="intent" value="save" disabled={pending}>
          {pending && intent === "save" ? "Saving..." : "Save"}
        </Button>
        <Button type="submit" name="intent" value="test" variant="secondary" disabled={pending}>
          {pending && intent === "test" ? "Testing..." : "Test connection"}
        </Button>
        {initial.host ? (
          <Button
            type="submit"
            name="intent"
            value="test-mode"
            variant="ghost"
            size="sm"
            formNoValidate
            disabled={pending}
          >
            Use test mode
          </Button>
        ) : null}
        <Result state={state} pending={pending} />
      </Actions>
    </form>
  );
}

function SmtpFields({ initial, errors }: { initial: SmtpFormValues; errors: Record<string, string[] | undefined> }) {
  const [provider, setProvider] = useState(() => detectProvider(initial.host));
  const preset = PROVIDERS.find((p) => p.id === provider);

  function choose(e: ChangeEvent<HTMLSelectElement>) {
    const next = PROVIDERS.find((p) => p.id === e.target.value);
    setProvider(e.target.value);
    const form = e.target.form;
    if (!next || !form) return;
    const set = (name: string, value: string | undefined) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (el && value !== undefined) el.value = value;
    };
    set("host", next.host);
    set("port", next.port?.toString());
    set("secure", next.secure?.toString());
    if (next.user) set("user", next.user);
  }

  return (
    <>
      <Field label="Provider" htmlFor="smtp-provider" hint={preset?.hint}>
        <Select id="smtp-provider" value={provider} onChange={choose}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="Host" htmlFor="smtp-host" error={errors.host} className="sm:col-span-6">
          <Input
            id="smtp-host"
            name="host"
            defaultValue={initial.host}
            placeholder="smtp.example.com"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <Field label="Port" htmlFor="smtp-port" error={errors.port} className="sm:col-span-2">
          <Input id="smtp-port" name="port" inputMode="numeric" defaultValue={initial.port} required />
        </Field>
        <Field label="Encryption" htmlFor="smtp-secure" error={errors.secure} className="sm:col-span-4">
          <Select id="smtp-secure" name="secure" defaultValue={String(initial.secure)}>
            <option value="true">SSL/TLS (465)</option>
            <option value="false">STARTTLS (587)</option>
          </Select>
        </Field>
        <Field label="Username" htmlFor="smtp-user" error={errors.user} className="sm:col-span-3">
          <Input id="smtp-user" name="user" defaultValue={initial.user} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Password" htmlFor="smtp-pass" error={errors.pass} className="sm:col-span-3">
          <Input
            id="smtp-pass"
            name="pass"
            type="password"
            autoComplete="new-password"
            placeholder={initial.hasPassword ? "Saved - leave blank to keep" : ""}
          />
        </Field>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

export function SenderForm({
  initial,
}: {
  initial: { fromName: string; fromEmail: string; replyTo: string; companyAddress: string };
}) {
  const { state, pending, onSubmit, errors } = useSettingsForm(saveSender);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From name" htmlFor="from-name" error={errors.fromName}>
          <Input id="from-name" name="fromName" defaultValue={initial.fromName} placeholder="Acme News" required />
        </Field>
        <Field label="From email" htmlFor="from-email" error={errors.fromEmail}>
          <Input
            id="from-email"
            name="fromEmail"
            type="email"
            defaultValue={initial.fromEmail}
            placeholder="news@yourdomain.com"
            required
          />
        </Field>
      </div>
      <Field label="Reply-to email" htmlFor="reply-to" error={errors.replyTo} hint="Optional. Replies go to the From email if empty.">
        <Input id="reply-to" name="replyTo" type="email" defaultValue={initial.replyTo} />
      </Field>
      <Field
        label="Company address"
        htmlFor="company-address"
        error={errors.companyAddress}
        hint="Shown in every email footer - required by law."
      >
        <Textarea
          id="company-address"
          name="companyAddress"
          rows={2}
          defaultValue={initial.companyAddress}
          placeholder="Acme Ltd, 1 High Street, Leeds LS1 1AA"
        />
      </Field>
      <Actions>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
        <Result state={state} pending={pending} />
      </Actions>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export function SendingForm({ initial }: { initial: { appUrl: string; sendRatePerSecond: number } }) {
  const { state, pending, onSubmit, errors } = useSettingsForm(saveSending);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field
        label="App URL"
        htmlFor="app-url"
        error={errors.appUrl}
        hint="Used in unsubscribe and tracking links. Must be your public https address when live."
      >
        <Input
          id="app-url"
          name="appUrl"
          type="url"
          defaultValue={initial.appUrl}
          placeholder="https://mail.yourdomain.com"
          spellCheck={false}
          className="font-mono"
          required
        />
      </Field>
      <Field label="Emails per second" htmlFor="send-rate" error={errors.sendRatePerSecond} className="max-w-40">
        <Input
          id="send-rate"
          name="sendRatePerSecond"
          type="number"
          min={1}
          max={50}
          step={1}
          defaultValue={initial.sendRatePerSecond}
          required
        />
      </Field>
      <Actions>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
        <Result state={state} pending={pending} />
      </Actions>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Deliverability
// ---------------------------------------------------------------------------

export function DeliverabilityForm({
  initial,
  smtpHost,
  webhookBase,
  webhookToken,
}: {
  initial: { dailySendLimit: number; bouncePauseRate: number };
  smtpHost: string;
  /** e.g. https://mail.example.com/api/webhooks/ */
  webhookBase: string;
  webhookToken: string;
}) {
  const { state, pending, onSubmit, errors } = useSettingsForm(saveDeliverability);
  const [provider, setProvider] = useState(() => detectWebhookProvider(smtpHost));
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${webhookBase}${provider}?token=${webhookToken}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. plain http): the field can still be selected and copied by hand.
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Daily send limit"
          htmlFor="daily-limit"
          error={errors.dailySendLimit}
          hint="0 = unlimited. On a new domain start low and raise it over a few weeks."
        >
          <Input
            id="daily-limit"
            name="dailySendLimit"
            type="number"
            min={0}
            step={1}
            defaultValue={initial.dailySendLimit}
            required
          />
        </Field>
        <Field
          label="Auto-pause bounce rate (%)"
          htmlFor="bounce-pause"
          error={errors.bouncePauseRate}
          hint="A campaign pauses itself above this. 0 = off."
        >
          <Input
            id="bounce-pause"
            name="bouncePauseRate"
            type="number"
            min={0}
            max={100}
            step={0.5}
            defaultValue={initial.bouncePauseRate}
            required
          />
        </Field>
      </div>
      <Field
        label="Bounce & complaint webhook"
        htmlFor="webhook-url"
        hint={`${WEBHOOK_PROVIDERS.find((p) => p.id === provider)?.hint ?? ""} Bounced addresses then stop receiving email.`}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            aria-label="Email provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="sm:w-40"
          >
            {WEBHOOK_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <Input
            id="webhook-url"
            readOnly
            value={webhookUrl}
            onFocus={(e) => e.currentTarget.select()}
            spellCheck={false}
            className="min-w-0 flex-1 font-mono text-xs"
          />
          <Button type="button" variant="secondary" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Field>
      <Actions>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
        <Result state={state} pending={pending} />
      </Actions>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Test email
// ---------------------------------------------------------------------------

export function TestEmailForm({ defaultTo }: { defaultTo: string }) {
  const { state, pending, onSubmit, errors } = useSettingsForm(sendTestEmail);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <label htmlFor="test-to" className="sr-only">
            Send a test email to
          </label>
          <Input
            id="test-to"
            name="to"
            type="email"
            autoComplete="email"
            defaultValue={defaultTo}
            placeholder="you@yourdomain.com"
            aria-invalid={errors.to ? true : undefined}
            required
          />
          {errors.to ? <p className="mt-1.5 text-xs text-red-600">{errors.to[0]}</p> : null}
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Sending..." : "Send test email"}
        </Button>
      </div>
      <Result state={state} pending={pending} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export function AccountForm({ email, minPasswordLength }: { email: string; minPasswordLength: number }) {
  const { state, pending, onSubmit, errors } = useSettingsForm(saveAccount);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Re-mount after a save to clear the password fields. */}
      <div key={state.savedAt ?? 0} className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="account-email" error={errors.email} className="sm:col-span-2">
          <Input id="account-email" name="email" type="email" autoComplete="username" defaultValue={email} required />
        </Field>
        <Field
          label="New password"
          htmlFor="account-new-password"
          error={errors.newPassword}
          hint={`Leave blank to keep it. At least ${minPasswordLength} characters.`}
        >
          <Input id="account-new-password" name="newPassword" type="password" autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" htmlFor="account-confirm" error={errors.confirm}>
          <Input id="account-confirm" name="confirm" type="password" autoComplete="new-password" />
        </Field>
        <Field
          label="Current password"
          htmlFor="account-current-password"
          error={errors.currentPassword}
          className="sm:col-start-1"
        >
          <Input
            id="account-current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
      </div>
      <Actions>
        <Button type="submit" disabled={pending}>
          {pending ? "Updating..." : "Update account"}
        </Button>
        <Result state={state} pending={pending} />
      </Actions>
    </form>
  );
}
