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
  /** One short line shown under the dropdown. */
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
    hint: "Use your SES SMTP username and password. Change eu-west-2 in Host if your region differs.",
  },
  {
    id: "resend",
    label: "Resend",
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    user: "resend",
    hint: "Username: resend. Password: your Resend API key.",
  },
  {
    id: "brevo",
    label: "Brevo",
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    hint: "Use your Brevo SMTP login and SMTP key.",
  },
  {
    id: "gmail",
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    hint: "Username: your Gmail address. Password: a Google app password.",
  },
  {
    id: "mailgun",
    label: "Mailgun",
    host: "smtp.mailgun.org",
    port: 587,
    secure: false,
    hint: "Use your domain's SMTP login. EU domains use smtp.eu.mailgun.org.",
  },
];

/** Which preset a saved host belongs to ("custom" when none match). */
export function detectProvider(host: string): string {
  const h = host.trim().toLowerCase();
  if (/^email-smtp\.[a-z0-9-]+\.amazonaws\.com$/.test(h)) return "ses";
  if (/^smtp(\.eu)?\.mailgun\.org$/.test(h)) return "mailgun";
  return PROVIDERS.find((p) => p.host && p.host === h)?.id ?? "custom";
}
