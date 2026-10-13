import { isValidEmail, normalizeEmail } from "@/lib/utils";

export const MAX_TEST_RECIPIENTS = 5;

export type ParsedRecipients = { ok: true; emails: string[] } | { ok: false; error: string };

/**
 * Parse the "send a test to" input: addresses separated by commas,
 * semicolons or whitespace. Lower-cased and de-duplicated.
 */
export function parseTestRecipients(input: string, max = MAX_TEST_RECIPIENTS): ParsedRecipients {
  const emails = [
    ...new Set(
      input
        .split(/[,;\s]+/)
        .map((part) => normalizeEmail(part))
        .filter(Boolean),
    ),
  ];
  if (emails.length === 0) {
    return { ok: false, error: "Enter at least one email address." };
  }
  const invalid = emails.filter((email) => !isValidEmail(email));
  if (invalid.length === 1) {
    return { ok: false, error: `"${invalid[0]}" isn't a valid email address.` };
  }
  if (invalid.length > 1) {
    return { ok: false, error: `These aren't valid email addresses: ${invalid.join(", ")}.` };
  }
  if (emails.length > max) {
    return { ok: false, error: `You can send a test to at most ${max} addresses at a time.` };
  }
  return { ok: true, emails };
}

export interface TestSender {
  name: string;
  /** Empty when no default sender is configured in Settings. */
  email: string;
}

/** Template test sends go out from the default sender in Settings ("Test" when it has no name). */
export function testSender(settings: { fromName: string; fromEmail: string }): TestSender {
  return { name: settings.fromName.trim() || "Test", email: settings.fromEmail.trim() };
}
