import type { OutgoingEmail } from "@/lib/mailer";
import { escapeHtml } from "@/lib/render";

// The double opt-in email: one button, nothing else. Pure (no settings / DB
// access) so it can be unit-tested; see sendConfirmationEmail in signup.ts.

export const DEFAULT_BRAND = "Inflix Marketing";

export interface ConfirmationEmailInput {
  to: string;
  firstName: string | null;
  confirmUrl: string;
  /** Sender from Settings. */
  fromName: string;
  fromEmail: string;
  replyTo: string;
  companyAddress: string;
}

export function buildConfirmationEmail(input: ConfirmationEmailInput): OutgoingEmail {
  const brand = input.fromName.trim() || DEFAULT_BRAND;
  const greeting = input.firstName?.trim() ? `Hi ${input.firstName.trim()},` : "Hi,";
  const url = escapeHtml(input.confirmUrl);
  const address = input.companyAddress.trim();

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confirm your subscription</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td style="padding:0 0 16px;font:600 14px/20px Arial,Helvetica,sans-serif;color:#64748b;text-align:center;">${escapeHtml(brand)}</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:32px;font:16px/24px Arial,Helvetica,sans-serif;color:#0f172a;">
<h1 style="margin:0 0 16px;font:600 20px/28px Arial,Helvetica,sans-serif;color:#0f172a;">Confirm your subscription</h1>
<p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 24px;">Please confirm that you want to receive emails from ${escapeHtml(brand)}.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#4f46e5;">
<a href="${url}" style="display:inline-block;padding:12px 24px;font:600 16px/20px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:6px;">Confirm subscription</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#64748b;">Button not working? Copy this link into your browser:<br><a href="${url}" style="color:#4f46e5;word-break:break-all;">${url}</a></p>
<p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#64748b;">If you didn't ask for this, ignore this email - you won't be subscribed.</p>
</td></tr>
<tr><td style="padding:16px 8px 0;font:12px/18px Arial,Helvetica,sans-serif;color:#94a3b8;text-align:center;">${escapeHtml(brand)}${address ? `<br>${escapeHtml(address).replace(/\r?\n/g, "<br>")}` : ""}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    greeting,
    "",
    `Please confirm that you want to receive emails from ${brand}:`,
    input.confirmUrl,
    "",
    "If you didn't ask for this, ignore this email - you won't be subscribed.",
    "",
    brand,
    address,
  ]
    .join("\n")
    .trim();

  return {
    to: input.to,
    from: { name: brand, address: input.fromEmail.trim() },
    replyTo: input.replyTo.trim() || null,
    subject: "Please confirm your subscription",
    html,
    text,
  };
}
