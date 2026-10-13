import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import type { Form } from "@/db/schema";
import { getForm } from "@/lib/forms/store";
import { HONEYPOT_FIELD, MAX_EMAIL_LENGTH, MAX_NAME_LENGTH, MAX_VALUE_LENGTH } from "@/lib/forms/validation";
import { PublicCard } from "../public-card";

// Public hosted sign-up page (see src/proxy.ts). A plain HTML form that posts
// to /api/subscribe/<id>, so it works without JavaScript; the endpoint
// redirects back here with ?done=1 or ?error=<code>.

type Props = {
  params: Promise<{ formId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ERRORS: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  missing_field: "Please fill in all required fields.",
  too_long: "One of the fields is too long.",
  rate_limited: "Too many attempts. Please try again in a few minutes.",
  invalid_request: "That didn't work. Please try again.",
  server_error: "Something went wrong. Please try again in a moment.",
};

type Lookup = { ok: true; form: Form | null } | { ok: false };

async function lookUp(formId: string): Promise<Lookup> {
  try {
    return { ok: true, form: await getForm(formId) };
  } catch (err) {
    // Database not configured / unreachable.
    console.error("[forms] hosted page lookup failed", err);
    return { ok: false };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { formId } = await params;
  const result = await lookUp(formId);
  const title = result.ok && result.form?.active ? result.form.title : "Sign up";
  return { title: { absolute: title }, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function HostedFormPage({ params, searchParams }: Props) {
  const { formId } = await params;
  const query = await searchParams;
  const embed = first(query.embed) === "1";
  const done = first(query.done) === "1";
  const error = ERRORS[first(query.error) ?? ""];

  const result = await lookUp(formId);

  if (!result.ok) {
    return (
      <PublicCard title="Temporarily unavailable" embed={embed}>
        <p>Sign-ups aren&apos;t working right now. Please try again in a few minutes.</p>
      </PublicCard>
    );
  }

  const form = result.form;
  if (!form || !form.active) {
    return (
      <PublicCard title="Form not available" embed={embed}>
        <p>This sign-up form is closed or the link is wrong.</p>
      </PublicCard>
    );
  }

  if (done) {
    return (
      <PublicCard title={form.doubleOptIn ? "Check your inbox" : "You're subscribed"} embed={embed}>
        <Alert tone="success">
          {form.doubleOptIn
            ? "Almost done - we sent you an email. Click the link in it to confirm your subscription."
            : form.successMessage}
        </Alert>
      </PublicCard>
    );
  }

  return (
    <PublicCard title={form.title} embed={embed}>
      {form.description ? <p className="whitespace-pre-line">{form.description}</p> : null}
      <form
        method="post"
        action={`/api/subscribe/${form.id}${embed ? "?embed=1" : ""}`}
        // In an iframe, the form's own redirect URL should replace the whole page.
        target={embed && form.redirectUrl ? "_top" : undefined}
        className="space-y-4"
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field label="Email" htmlFor="form-email">
          <Input
            id="form-email"
            name="email"
            type="email"
            required
            maxLength={MAX_EMAIL_LENGTH}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </Field>
        {form.fields.map((field) => {
          const builtIn = field.key === "first_name" || field.key === "last_name";
          return (
            <Field
              key={field.key}
              htmlFor={`form-${field.key}`}
              label={
                <>
                  {field.label}
                  {field.required ? null : <span className="font-normal text-slate-400"> (optional)</span>}
                </>
              }
            >
              <Input
                id={`form-${field.key}`}
                name={field.key}
                required={field.required}
                maxLength={builtIn ? MAX_NAME_LENGTH : MAX_VALUE_LENGTH}
                autoComplete={field.key === "first_name" ? "given-name" : field.key === "last_name" ? "family-name" : "off"}
              />
            </Field>
          );
        })}
        {/* Spam trap: hidden from people, filled in by bots. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Leave this field empty
            <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>
        <Button type="submit" className="w-full">
          {form.buttonText}
        </Button>
        <p className="text-xs text-slate-500">You can unsubscribe at any time.</p>
      </form>
    </PublicCard>
  );
}
