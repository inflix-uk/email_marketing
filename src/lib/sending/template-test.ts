import { collections } from "@/db";
import { newId, type TestSendDoc } from "@/db/schema";
import { classifySendError, sendEmail } from "@/lib/mailer";
import type { MergeContact } from "@/lib/render";
import { getSettings } from "@/lib/settings";
import { contentHash } from "@/lib/spam-check";
import { getLinkContext, previewUnsubscribeUrl } from "@/lib/tokens";
import { buildEmail } from "./prepare";

// Template test centre: send a template's (possibly unsaved) content to a few
// addresses - your own inbox or a checker such as Mail-Tester - and log each
// attempt in `test_sends`. No campaign, no contact, nothing in the stats, and
// the unsubscribe link is the harmless preview link.

/** Shown in merge tags when the test address isn't one of your contacts. */
export const TEST_PROFILE: Omit<MergeContact, "email"> = {
  firstName: "Alex",
  lastName: "Morgan",
  fields: { company: "Example Ltd", city: "London" },
};

export interface TemplateTestInput {
  templateId: string;
  /** The template's subject (what the content hash is based on). */
  subject: string;
  /** Optional subject for this test only; defaults to "[Test] " + subject. */
  testSubject?: string | null;
  previewText?: string | null;
  html: string;
  fromName: string;
  fromEmail: string;
}

export interface TemplateTestResult {
  to: string;
  ok: boolean;
  error: string | null;
}

/** The hash stored with a test, comparable with contentHash() of the editor's current content. */
export function templateTestHash(subject: string, html: string): string {
  return contentHash({ subject, html });
}

/**
 * Send one test per address (already validated, max 5) and log each one.
 * Throws only when nothing could be tried (mail server unreachable is logged
 * per address and reported in the results).
 */
export async function sendTemplateTestEmails(input: TemplateTestInput, to: string[]): Promise<TemplateTestResult[]> {
  const { contacts, testSends } = await collections();
  const [links, settings, known] = await Promise.all([
    getLinkContext(),
    getSettings(),
    contacts
      .find({ email: { $in: to } }, { projection: { email: 1, firstName: 1, lastName: 1, fields: 1 } })
      .toArray(),
  ]);
  const byEmail = new Map(known.map((c) => [c.email, c]));
  const unsubscribeUrl = previewUnsubscribeUrl(links);
  const hash = templateTestHash(input.subject, input.html);
  const custom = input.testSubject?.trim();
  const subject = custom || `[Test] ${input.subject.trim() || "(no subject)"}`;
  const sender = `${input.fromName} <${input.fromEmail}>`;

  const results: TemplateTestResult[] = [];
  const logs: TestSendDoc[] = [];
  let configError: string | null = null;

  for (const address of to) {
    const c = byEmail.get(address);
    // Only the recipient's own contact data is used, never someone else's.
    const contact: MergeContact = c
      ? { email: c.email, firstName: c.firstName, lastName: c.lastName, fields: c.fields ?? {} }
      : { email: address, ...TEST_PROFILE };
    const msg = buildEmail(
      { subject, previewText: input.previewText, html: input.html, fromName: input.fromName, fromEmail: input.fromEmail },
      contact,
      { sendId: null, unsubscribeUrl, companyAddress: settings.companyAddress },
    );
    msg.to = address;
    // Like a real send (checkers score this header); the preview link unsubscribes nobody.
    msg.headers = { ...msg.headers, "List-Unsubscribe": `<${unsubscribeUrl}>` };

    let providerMessageId: string | null = null;
    let error: string | null = configError;
    if (!error) {
      try {
        providerMessageId = (await sendEmail(msg)).messageId || null;
      } catch (err) {
        const { config, message } = classifySendError(err);
        error = config ? `Could not connect to the mail server: ${message}` : message;
        // The same server problem would fail every other address too.
        if (config) configError = error;
      }
    }
    results.push({ to: address, ok: !error, error });
    logs.push({
      _id: newId(),
      templateId: input.templateId,
      contentHash: hash,
      to: address,
      subject: msg.subject,
      sender,
      status: error ? "failed" : "sent",
      error,
      providerMessageId,
      createdAt: new Date(),
    });
  }

  if (logs.length > 0) await testSends.insertMany(logs, { ordered: false });
  return results;
}

/** The latest template tests, newest first. */
export async function recentTemplateTests(templateId: string, limit = 5): Promise<TestSendDoc[]> {
  const { testSends } = await collections();
  return testSends.find({ templateId }).sort({ createdAt: -1 }).limit(limit).toArray();
}
