import { collections } from "@/db";
import { classifySendError, sendEmail } from "@/lib/mailer";
import { SAMPLE_CONTACT, type MergeContact } from "@/lib/render";
import { getSettings } from "@/lib/settings";
import { getLinkContext, previewUnsubscribeUrl } from "@/lib/tokens";
import { isValidEmail, normalizeEmail } from "@/lib/utils";
import { buildEmail, type EmailContent } from "./prepare";

export const MAX_TEST_RECIPIENTS = 5;

/**
 * One-off test send of unsaved/saved content to up to 5 addresses. Merge tags
 * use the matching contact's data when the address is a known contact,
 * otherwise SAMPLE_CONTACT. No tracking; the unsubscribe link is the preview one.
 * Throws an Error with a user-facing message on failure.
 */
export async function sendTestEmail(input: EmailContent, to: string[]): Promise<void> {
  const addresses = [...new Set(to.map(normalizeEmail).filter(Boolean))];
  if (addresses.length === 0) throw new Error("Enter at least one email address to send the test to.");
  if (addresses.length > MAX_TEST_RECIPIENTS) {
    throw new Error(`You can send a test to at most ${MAX_TEST_RECIPIENTS} addresses at a time.`);
  }
  const invalid = addresses.filter((a) => !isValidEmail(a));
  if (invalid.length > 0) {
    throw new Error(`Not a valid email address: ${invalid.join(", ")}`);
  }
  if (!input.subject.trim()) throw new Error("Add a subject line before sending a test.");
  if (!input.html.trim()) throw new Error("The email content is empty.");
  const from = input.fromEmail.trim();
  if (!isValidEmail(from)) throw new Error(`The from email address "${from}" is not valid.`);
  const replyTo = input.replyTo?.trim();
  if (replyTo && !isValidEmail(replyTo)) throw new Error(`The reply-to address "${replyTo}" is not valid.`);

  const { contacts } = await collections();
  const [links, settings, known] = await Promise.all([
    getLinkContext(),
    getSettings(),
    contacts
      .find({ email: { $in: addresses } }, { projection: { email: 1, firstName: 1, lastName: 1, fields: 1 } })
      .toArray(),
  ]);
  const byEmail = new Map<string, MergeContact>(
    known.map((c) => [c.email, { email: c.email, firstName: c.firstName, lastName: c.lastName, fields: c.fields ?? {} }]),
  );
  const unsubscribeUrl = previewUnsubscribeUrl(links);

  const failures: string[] = [];
  for (const address of addresses) {
    const contact = byEmail.get(address) ?? SAMPLE_CONTACT;
    const msg = buildEmail(input, contact, { sendId: null, unsubscribeUrl, companyAddress: settings.companyAddress });
    msg.to = address;
    msg.subject = `[Test] ${msg.subject}`;
    try {
      await sendEmail(msg);
    } catch (err) {
      const { config, message } = classifySendError(err);
      if (config) throw new Error(`Could not connect to the mail server: ${message}`);
      failures.push(`${address} (${message})`);
    }
  }
  if (failures.length > 0) {
    const sent = addresses.length - failures.length;
    throw new Error(
      `${sent > 0 ? `Sent to ${sent} of ${addresses.length} addresses, but f` : "F"}ailed for ${failures.join(", ")}`,
    );
  }
}
