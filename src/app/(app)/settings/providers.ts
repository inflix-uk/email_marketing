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

/** Which preset a saved host belongs to ("custom" when none match). */
export function detectProvider(host: string): string {
  const h = host.trim().toLowerCase();
  if (/^email-smtp\.[a-z0-9-]+\.amazonaws\.com$/.test(h)) return "ses";
  if (/^smtp(\.eu)?\.mailgun\.org$/.test(h)) return "mailgun";
  return PROVIDERS.find((p) => p.host && p.host === h)?.id ?? "custom";
}
