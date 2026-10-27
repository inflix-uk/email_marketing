"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { collections } from "@/db";
import { requirePermission } from "@/lib/auth";
import { sendTemplateTestEmails } from "@/lib/sending";
import { getSettings, isDevMailer } from "@/lib/settings";
import { parseTestRecipients, testSender } from "@/lib/templates/recipients";

export interface SendTestState {
  ok?: boolean;
  message?: string;
  /** The message is a caveat (nothing actually went out, or only some went), not a success. */
  warning?: boolean;
  error?: string;
}

const sendTestSchema = z.object({
  id: z.string().trim().min(1).max(100),
  to: z.string().transform((value, ctx) => {
    const parsed = parseTestRecipients(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.error });
      return z.NEVER;
    }
    return parsed.emails;
  }),
  /** Optional subject for this test only. */
  testSubject: z.string().trim().max(300, "Keep the test subject under 300 characters."),
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

/**
 * Sends the editor's current (possibly unsaved) content to up to 5 addresses
 * and logs each one in test_sends. No campaign, no stats.
 */
export async function sendTemplateTest(_prev: SendTestState, formData: FormData): Promise<SendTestState> {
  await requirePermission("send");
  const parsed = sendTestSchema.safeParse({
    id: text(formData, "id"),
    to: text(formData, "to"),
    testSubject: text(formData, "testSubject"),
    name: text(formData, "name"),
    subject: text(formData, "subject"),
    previewText: text(formData, "previewText"),
    html: text(formData, "html"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the address and try again." };
  }

  const { id, to, testSubject, name, subject, previewText, html } = parsed.data;
  const { templates } = await collections();
  if (!(await templates.countDocuments({ _id: id }, { limit: 1 }))) {
    return { error: "This template no longer exists." };
  }

  const settings = await getSettings();
  const sender = testSender(settings);
  if (!sender.email) {
    return { error: "Add a sender email in Settings first." };
  }

  let results;
  try {
    results = await sendTemplateTestEmails(
      {
        templateId: id,
        subject: subject || name,
        testSubject: testSubject || null,
        previewText: previewText || null,
        html,
        fromName: sender.name,
        fromEmail: sender.email,
      },
      to,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The test email couldn't be sent." };
  }
  revalidatePath(`/templates/${id}`);

  const failed = results.filter((r) => !r.ok);
  const sent = results.filter((r) => r.ok).map((r) => r.to);
  if (failed.length === results.length) {
    return { error: failed[0]?.error ?? "The test email couldn't be sent." };
  }
  if (isDevMailer(settings)) {
    return { ok: true, warning: true, message: "Not sent - email sending isn't set up yet." };
  }
  if (failed.length > 0) {
    return {
      ok: true,
      warning: true,
      message: `Sent to ${sent.join(", ")}. Failed for ${failed.map((f) => `${f.to} (${f.error})`).join(", ")}.`,
    };
  }
  return { ok: true, message: `Sent to ${sent.join(", ")}.` };
}
