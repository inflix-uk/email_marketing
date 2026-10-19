"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { sendTestEmail } from "@/lib/sending";
import { getSettings, isDevMailer } from "@/lib/settings";
import { parseTestRecipients, testSender } from "@/lib/templates/recipients";

export interface SendTestState {
  ok?: boolean;
  message?: string;
  /** The message is a caveat (nothing actually went out), not a success. */
  warning?: boolean;
  error?: string;
}

const sendTestSchema = z.object({
  to: z.string().transform((value, ctx) => {
    const parsed = parseTestRecipients(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.error });
      return z.NEVER;
    }
    return parsed.emails;
  }),
  name: z.string().trim(),
  subject: z.string().trim(),
  /** The template's stored preview text (no longer editable on the form). */
  previewText: z.string().trim(),
  html: z.string().refine((value) => value.trim().length > 0, "Add some content before sending a test."),
});

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Sends the editor's current (possibly unsaved) content to up to 5 addresses. */
export async function sendTemplateTest(_prev: SendTestState, formData: FormData): Promise<SendTestState> {
  await requireSession();
  const parsed = sendTestSchema.safeParse({
    to: text(formData, "to"),
    name: text(formData, "name"),
    subject: text(formData, "subject"),
    previewText: text(formData, "previewText"),
    html: text(formData, "html"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the address and try again." };
  }

  const settings = await getSettings();
  const sender = testSender(settings);
  if (!sender.email) {
    return { error: "Add a sender email in Settings first." };
  }

  const { to, name, subject, previewText, html } = parsed.data;
  try {
    await sendTestEmail(
      {
        subject: subject || name || "Test email",
        previewText: previewText || null,
        html,
        fromName: sender.name,
        fromEmail: sender.email,
        replyTo: null,
      },
      to,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The test email couldn't be sent." };
  }

  if (isDevMailer(settings)) {
    return { ok: true, warning: true, message: "Not sent - email sending isn't set up yet." };
  }
  return { ok: true, message: `Sent to ${to.join(", ")}.` };
}
