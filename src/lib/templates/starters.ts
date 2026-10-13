import { STARTER_TEMPLATES, type StarterTemplate } from "@/lib/starter-templates";

// The choices offered on "New template": the ready-made starters plus a
// minimal blank document.

export const BLANK_STARTER: StarterTemplate = {
  key: "blank",
  name: "Blank",
  description: "A minimal HTML skeleton - bring your own design.",
  subject: "",
  previewText: "",
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title></title>
</head>
<body style="margin:0;padding:32px 24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#374151;">
  <p style="margin:0 0 16px;">Hi {{first_name | there}},</p>
  <p style="margin:0 0 16px;">Start writing your email here.</p>
  <p style="margin:32px 0 0;font-size:12px;line-height:18px;color:#6b7280;">
    {{company_address}}<br>
    <a href="{{unsubscribe_url}}" style="color:#6b7280;">Unsubscribe</a>
  </p>
</body>
</html>`,
};

export const TEMPLATE_STARTERS: StarterTemplate[] = [...STARTER_TEMPLATES, BLANK_STARTER];

export function findStarter(key: string): StarterTemplate | undefined {
  return TEMPLATE_STARTERS.find((starter) => starter.key === key);
}
