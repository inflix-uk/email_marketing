import { STARTER_TEMPLATES } from "@/lib/starter-templates";

// Where a new campaign's content comes from: a saved template, one of the
// built-in starters, or a blank layout. Encoded as a single form value.

export const BLANK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title></title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="padding:32px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#374151;">
      <p style="margin:0 0 16px;">Hi {{first_name | there}},</p>
      <p style="margin:0 0 16px;">Start writing your email here.</p>
    </td>
  </tr>
  <tr>
    <td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b7280;">
      {{company_address}}<br>
      <a href="{{unsubscribe_url}}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
    </td>
  </tr>
</table>
</body>
</html>`;

export type StartingPointValue = "blank" | `starter:${string}` | `template:${string}`;

/** Keep the campaign's own content as it is (no template behind it any more). */
export const CURRENT_DESIGN = "current";

export function starterValue(key: string): StartingPointValue {
  return `starter:${key}`;
}

export function templateValue(id: string): StartingPointValue {
  return `template:${id}`;
}

export const DEFAULT_STARTING_POINT: StartingPointValue = STARTER_TEMPLATES[0]
  ? starterValue(STARTER_TEMPLATES[0].key)
  : "blank";

export function parseStartingPoint(
  value: string,
): { kind: "blank" } | { kind: "starter"; key: string } | { kind: "template"; id: string } | null {
  if (value === "blank") return { kind: "blank" };
  if (value.startsWith("starter:")) return { kind: "starter", key: value.slice("starter:".length) };
  if (value.startsWith("template:")) return { kind: "template", id: value.slice("template:".length) };
  return null;
}
