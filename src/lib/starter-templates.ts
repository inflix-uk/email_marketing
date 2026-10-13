// Ready-made email templates offered when creating a new template and used
// by the seed script. Table-based layout + inline styles so they render in
// Outlook, Gmail and Apple Mail.

export interface StarterTemplate {
  key: string;
  name: string;
  description: string;
  subject: string;
  previewText: string;
  html: string;
}

function layout(opts: { preheader: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title></title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;">
${opts.body}
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr>
          <td style="padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b7280;text-align:center;">
            {{company_address}}<br>
            You are receiving this email because you subscribed to our updates.<br>
            <a href="{{unsubscribe_url}}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

const text = "font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#374151;";
const heading = "font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0 0 16px;";
const button =
  "display:inline-block;background:#4f46e5;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;padding:12px 24px;border-radius:6px;";

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: "newsletter",
    name: "Simple newsletter",
    description: "Heading, a few paragraphs and a call-to-action button.",
    subject: "Our latest news, {{first_name | friend}}",
    previewText: "Here's what's new this month.",
    html: layout({
      preheader: "Here's what's new this month.",
      body: `        <tr>
          <td style="padding:40px 40px 8px;">
            <h1 style="${heading}font-size:26px;line-height:32px;">Hi {{first_name | there}},</h1>
            <p style="${text}margin:0 0 16px;">Here's a quick round-up of what we've been working on this month.</p>
            <p style="${text}margin:0 0 16px;">Replace this text with your own story. Keep paragraphs short, and lead with the thing your reader cares about most.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 40px 40px;">
            <a href="https://example.com" style="${button}">Read more</a>
          </td>
        </tr>`,
    }),
  },
  {
    key: "announcement",
    name: "Announcement",
    description: "Big headline and one clear action - for launches and offers.",
    subject: "Big news, {{first_name | friend}}!",
    previewText: "Something new is here.",
    html: layout({
      preheader: "Something new is here.",
      body: `        <tr>
          <td style="padding:48px 40px 16px;text-align:center;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#4f46e5;margin:0 0 12px;">Announcement</p>
            <h1 style="${heading}font-size:32px;line-height:40px;">Something new is here</h1>
            <p style="${text}margin:0 0 24px;">{{first_name | Hi}}, we're excited to share our latest launch with you. Describe the benefit in one or two sentences.</p>
            <a href="https://example.com" style="${button}">Find out more</a>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 40px 48px;text-align:center;">
            <p style="${text}font-size:14px;color:#6b7280;margin:0;">Questions? Just reply to this email.</p>
          </td>
        </tr>`,
    }),
  },
  {
    key: "plain",
    name: "Plain text style",
    description: "Looks like a personal email - great for deliverability.",
    subject: "Quick question, {{first_name | there}}",
    previewText: "",
    html: layout({
      preheader: "",
      body: `        <tr>
          <td style="padding:40px;">
            <p style="${text}margin:0 0 16px;">Hi {{first_name | there}},</p>
            <p style="${text}margin:0 0 16px;">Write your message here, as if you were writing to one person.</p>
            <p style="${text}margin:0;">Best,<br>The Team</p>
          </td>
        </tr>`,
    }),
  },
];
