// What stops a campaign from going out (Send now / Schedule). Pure, so the
// rules are unit-tested and the same everywhere. A missing unsubscribe link is
// not a blocker: buildEmail adds a footer with one.

import type { CampaignFormat } from "@/db/schema";
import { htmlToPlainText } from "@/lib/plain-text";
import { isValidEmail } from "@/lib/utils";

export interface SendCheckInput {
  subject: string;
  html: string;
  format?: CampaignFormat;
  textBody?: string | null;
  fromEmail: string;
  replyTo?: string | null;
  /** Lists chosen. */
  listCount: number;
  /** Subscribed contacts in those lists. */
  recipients: number;
}

export type BlockerField = "subject" | "source" | "listIds" | "replyTo" | "sender";

export interface SendBlocker {
  field: BlockerField;
  message: string;
}

/** True for values that would break an email header (header injection). */
export function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}

export function sendBlockers(input: SendCheckInput): SendBlocker[] {
  const out: SendBlocker[] = [];
  if (!input.subject.trim()) out.push({ field: "subject", message: "Add a subject." });

  const hasContent =
    input.format === "text"
      ? Boolean(input.textBody?.trim() || htmlToPlainText(input.html).trim())
      : Boolean(input.html.trim());
  if (!hasContent) out.push({ field: "source", message: "The email is empty. Pick another template." });

  const from = input.fromEmail.trim();
  if (!from) out.push({ field: "sender", message: "Add your sender email in Settings first." });
  else if (!isValidEmail(from) || hasLineBreak(input.fromEmail)) {
    out.push({ field: "sender", message: `The sender email "${from}" is not valid. Fix it in Settings.` });
  }

  const replyTo = input.replyTo ?? "";
  if (replyTo.trim() && (!isValidEmail(replyTo) || hasLineBreak(replyTo))) {
    out.push({ field: "replyTo", message: "The reply-to address is not valid." });
  }

  if (input.listCount === 0) out.push({ field: "listIds", message: "Choose who to send it to." });
  else if (input.recipients <= 0) out.push({ field: "listIds", message: "No one on these lists can receive email yet." });
  return out;
}
