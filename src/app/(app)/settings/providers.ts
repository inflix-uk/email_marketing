// SMTP presets for the provider dropdown on the Settings page. Choosing one
// pre-fills host / port / encryption; every field stays editable.

export interface ProviderPreset {
  id: string;
  label: string;
  host?: string;
  port?: number;
  secure?: boolean;
  /** Fixed SMTP username, if the provider has one. */
  user?: string;
  hint?: string;
}

export const PROVIDERS: ProviderPreset[] = [
  { id: "custom", label: "Custom SMTP" },
  {
    id: "ses",
    label: "Amazon SES",
    host: "email-smtp.eu-west-2.amazonaws.com",
    port: 587,
    secure: false,
    hint: "Use SES SMTP credentials (not AWS access keys). Change eu-west-2 in the host if your SES region differs.",
  },
  {
    id: "resend",
    label: "Resend",
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    user: "resend",
    hint: "Username is resend; the password is an API key with sending access.",
  },
  {
    id: "brevo",
    label: "Brevo",
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    hint: "Use the SMTP login and SMTP key from Brevo → SMTP & API → SMTP.",
  },
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    hint: "Username is your full address; the password is an app password (needs 2-step verification).",
  },
  {
    id: "mailgun",
    label: "Mailgun",
    host: "smtp.mailgun.org",
    port: 587,
    secure: false,
    hint: "Use your domain's SMTP credentials. EU domains use smtp.eu.mailgun.org.",
  },
];

/** Providers with a bounce/complaint webhook parser: /api/webhooks/<id> (see src/lib/sending/webhooks.ts). */
export const WEBHOOK_PROVIDERS: { id: string; label: string; hint: string }[] = [
  { id: "ses", label: "Amazon SES", hint: "Subscribe this URL (HTTPS) to the SNS topic for your SES bounce and complaint notifications." },
  { id: "resend", label: "Resend", hint: "Add it under Webhooks for the email.bounced and email.complained events." },
  { id: "brevo", label: "Brevo", hint: "Add it as a transactional webhook for the hard bounce, blocked and spam events." },
  { id: "mailgun", label: "Mailgun", hint: "Add it for the Permanent Failure and Spam Complaints webhooks." },
  { id: "generic", label: "Other", hint: 'POST JSON like { "type": "bounce" or "complaint", "email": "..." } to it.' },
];

/** The webhook provider matching a saved SMTP host ("generic" when none match). */
export function detectWebhookProvider(host: string): string {
  const id = detectProvider(host);
  return WEBHOOK_PROVIDERS.some((p) => p.id === id) ? id : "generic";
}

/** Which preset a saved host belongs to ("custom" when none match). */
export function detectProvider(host: string): string {
  const h = host.trim().toLowerCase();
  if (/^email-smtp\.[a-z0-9-]+\.amazonaws\.com$/.test(h)) return "ses";
  if (/^smtp(\.eu)?\.mailgun\.org$/.test(h)) return "mailgun";
  return PROVIDERS.find((p) => p.host && p.host === h)?.id ?? "custom";
}
