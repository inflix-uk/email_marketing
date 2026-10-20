"use client";

import { startTransition, useActionState, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { saveAccount, saveEmailSending, saveSender, type SettingsFormState } from "./actions";
import { detectProvider, PROVIDERS } from "./providers";
import { PasswordInput } from "@/components/ui/password-input";

type Action = (prev: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;

/**
 * useActionState, submitted through a transition rather than <form action>:
 * React resets uncontrolled inputs after a form action, which would wipe what
 * was typed (e.g. after a failed test email or a validation error).
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

// ---------------------------------------------------------------------------
// Email sending
// ---------------------------------------------------------------------------

export interface SmtpFormValues {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Whether a password is saved (the password itself never reaches the browser). */
  hasPassword: boolean;
}

export function EmailSendingForm({ initial, testTo }: { initial: SmtpFormValues; testTo: string }) {
  const { state, pending, intent, onSubmit, errors } = useSettingsForm(saveEmailSending);
  const testing = intent === "test";

  return (
    <form onSubmit={onSubmit} className="space-y-4" autoComplete="off">
      {/* Re-mount after a save so the fields show what is now stored. */}
      <SmtpFields key={state.savedAt ?? 0} initial={initial} errors={errors} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="submit" name="intent" value="save" disabled={pending}>
          {pending && !testing ? "Saving..." : "Save"}
        </Button>
        {!testing ? <Result state={state} pending={pending} /> : null}
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-4">
        <Field label="Send a test email to" htmlFor="test-to" error={errors.to}>
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* Not type="email"/required: that would also block "Save". Checked on the server. */}
            <Input
              id="test-to"
              name="to"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              defaultValue={testTo}
              placeholder="you@yourdomain.com"
              className="min-w-0 flex-1"
            />
            <Button type="submit" name="intent" value="test" variant="secondary" disabled={pending}>
              {pending && testing ? "Sending..." : "Send test email"}
            </Button>
          </div>
        </Field>
        {testing ? <Result state={state} pending={pending} /> : null}
      </div>
    </form>
  );
}

const PORT_ENCRYPTION: Record<string, string> = { "465": "true", "587": "false", "25": "false", "2525": "false" };

function SmtpFields({ initial, errors }: { initial: SmtpFormValues; errors: Record<string, string[] | undefined> }) {
  const [provider, setProvider] = useState(() => detectProvider(initial.host));
  const hint = PROVIDERS.find((p) => p.id === provider)?.hint;

  function choose(e: ChangeEvent<HTMLSelectElement>) {
    const next = PROVIDERS.find((p) => p.id === e.target.value);
    setProvider(e.target.value);
    const form = e.target.form;
    if (!next || !form) return;
    const set = (name: string, value: string | undefined) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (el && value !== undefined) {
        el.value = value;
        // Let the searchable dropdown show the new choice.
        if (el instanceof HTMLSelectElement) el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    set("host", next.host);
    set("port", next.port?.toString());
    set("secure", next.secure?.toString());
    if (next.user) set("user", next.user);
  }

  // The usual ports have one matching encryption: pick it so it needs no extra click.
  function portChanged(e: ChangeEvent<HTMLInputElement>) {
    const secure = PORT_ENCRYPTION[e.target.value.trim()];
    const select = e.target.form?.elements.namedItem("secure") as HTMLSelectElement | null;
    if (secure && select && select.value !== secure) {
      select.value = secure;
      // Let the searchable dropdown show the new choice.
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Provider" htmlFor="smtp-provider">
        <Select id="smtp-provider" value={provider} onChange={choose}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Host" htmlFor="smtp-host" error={errors.host}>
        <Input
          id="smtp-host"
          name="host"
          defaultValue={initial.host}
          placeholder="smtp.example.com"
          spellCheck={false}
          className="font-mono"
        />
      </Field>
      {hint ? <p className="-mt-2 text-xs text-slate-500 sm:col-span-2">{hint}</p> : null}
      <Field label="Port" htmlFor="smtp-port" error={errors.port}>
        <Input id="smtp-port" name="port" inputMode="numeric" defaultValue={initial.port} onChange={portChanged} required />
      </Field>
      <Field label="Encryption" htmlFor="smtp-secure" error={errors.secure}>
        <Select id="smtp-secure" name="secure" defaultValue={String(initial.secure)}>
          <option value="true">SSL (port 465)</option>
          <option value="false">STARTTLS (port 587)</option>
        </Select>
      </Field>
      <Field label="Username" htmlFor="smtp-user" error={errors.user}>
        <Input id="smtp-user" name="user" defaultValue={initial.user} autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Password" htmlFor="smtp-pass" error={errors.pass}>
        <PasswordInput
          id="smtp-pass"
          name="pass"
          autoComplete="new-password"
          placeholder={initial.hasPassword ? "Saved (leave blank to keep)" : ""}
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

export function SenderForm({
  initial,
  appUrlSaved,
}: {
  initial: { fromName: string; fromEmail: string; companyAddress: string; appUrl: string };
  /** false = the website address is a suggestion from this page's address, not stored yet. */
  appUrlSaved: boolean;
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
        <Field
          label="Company address"
          htmlFor="company-address"
          error={errors.companyAddress}
          hint="Shown in every email footer - required by law."
          className="sm:col-span-2"
        >
          <Textarea
            id="company-address"
            name="companyAddress"
            rows={2}
            defaultValue={initial.companyAddress}
            placeholder="Acme Ltd, 1 High Street, Leeds LS1 1AA"
          />
        </Field>
        <Field
          label="Website address of this app"
          htmlFor="app-url"
          error={errors.appUrl}
          hint={appUrlSaved ? "Used for unsubscribe links." : "Used for unsubscribe links. Not saved yet - click Save."}
          className="sm:col-span-2"
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
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
        <Result state={state} pending={pending} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export function AccountForm({ email }: { email: string }) {
  const { state, pending, onSubmit, errors } = useSettingsForm(saveAccount);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Re-mount after a save to clear the password fields. */}
      <div key={state.savedAt ?? 0} className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="account-email" error={errors.email}>
          <Input id="account-email" name="email" type="email" autoComplete="username" defaultValue={email} required />
        </Field>
        <Field label="Current password" htmlFor="account-current-password" error={errors.currentPassword}>
          <PasswordInput
            id="account-current-password"
            name="currentPassword"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="New password" htmlFor="account-new-password" error={errors.newPassword} hint="Leave blank to keep it.">
          <PasswordInput id="account-new-password" name="newPassword" autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" htmlFor="account-confirm" error={errors.confirm}>
          <PasswordInput id="account-confirm" name="confirm" autoComplete="new-password" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Updating..." : "Update account"}
        </Button>
        <Result state={state} pending={pending} />
      </div>
    </form>
  );
}
