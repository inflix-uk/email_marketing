"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, updateAccount } from "@/lib/auth";
import { classifySendError, sendEmail } from "@/lib/mailer";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { escapeHtml } from "@/lib/render";
import { getSettings, updateSettings, type SmtpSettings } from "@/lib/settings";
import { isValidEmail, normalizeEmail } from "@/lib/utils";

// Each form saves only the fields it shows: updateSettings() $sets just the
// keys it is given, so settings that are no longer on the page (reply-to,
// sending speed, daily limit, bounce pause) keep their stored values.

export interface SettingsFormState {
  ok?: string;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set after a successful save, so the form re-mounts with the saved values. */
  savedAt?: number;
}

type FieldErrors = NonNullable<SettingsFormState["fieldErrors"]>;

function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData) if (typeof value === "string") out[key] = value;
  return out;
}

function invalid(error: z.ZodError): SettingsFormState {
  return { fieldErrors: z.flattenError(error).fieldErrors as FieldErrors };
}

function saved(message = "Saved"): SettingsFormState {
  revalidatePath("/", "layout"); // also updates the "not set up" banner
  return { ok: message, savedAt: Date.now() };
}

// nodemailer's own timeouts are long; give the page a faster answer.
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const email = (message = "Enter a valid email address") =>
  z.string().trim().refine(isValidEmail, message).transform(normalizeEmail);

// ---------------------------------------------------------------------------
// Email sending (SMTP): Save, or Send test email (which also saves on success)
// ---------------------------------------------------------------------------

const smtpSchema = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === "" || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(v), "Enter a host name like smtp.example.com"),
  port: z
    .string()
    .trim()
    .refine((v) => /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535, "Port must be a number from 1 to 65535")
    .transform(Number),
  secure: z.enum(["true", "false"], "Choose an encryption type").transform((v) => v === "true"),
  user: z.string().trim().max(320, "Username is too long"),
  pass: z.string().max(1000, "Password is too long"),
});

const TIMEOUT_MESSAGE = "The email server didn't answer within 30 seconds";

function testEmailHtml(lines: string[], companyAddress: string): string {
  const body = lines.map((l) => `<p style="margin:0 0 12px;">${escapeHtml(l)}</p>`).join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Test email</title></head>
<body style="margin:0;padding:32px 16px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px 32px;font-size:15px;line-height:22px;color:#334155;">
<h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">Your email settings work</h1>${body}
</div>
${companyAddress ? `<p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#64748b;text-align:center;">${escapeHtml(companyAddress)}</p>` : ""}
</body></html>`;
}

/**
 * intent=save: store the SMTP fields.
 * intent=test: send a test email with the values in the form (saved or not)
 * and store them only if it went through - a successful send proves the
 * connection and login.
 *
 * The saved password never goes to the browser: a blank password field keeps
 * it, but only while the host and username stay the same (so it is never
 * handed to a different server).
 */
export async function saveEmailSending(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireSession();
  const test = formData.get("intent") === "test";

  const parsed = smtpSchema.safeParse(fields(formData));
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;

  const settings = await getSettings();
  const current = settings.smtp;
  const sameServer = input.host === current.host.trim().toLowerCase() && input.user === current.user;
  let pass = input.pass;
  if (!pass && input.user) {
    if (sameServer && current.pass) pass = current.pass;
    else if (input.host) return { fieldErrors: { pass: ["Enter the password"] } };
  }
  const smtp: SmtpSettings = { host: input.host, port: input.port, secure: input.secure, user: input.user, pass };

  if (!test) {
    await updateSettings({ smtp });
    return saved(smtp.host ? "Saved" : "Saved. Emails won't be sent until you add your email provider.");
  }

  const to = email("Enter the address to send the test to").safeParse(String(formData.get("to") ?? ""));
  if (!to.success) return { fieldErrors: { to: to.error.issues.map((i) => i.message) } };
  if (!smtp.host) return { fieldErrors: { host: ["Enter your email provider's host first"] } };
  if (!settings.fromEmail) return { error: "Add a From email under Sender first, then send the test again." };

  try {
    await withTimeout(
      sendEmail(
        {
          to: to.data,
          from: { name: settings.fromName, address: settings.fromEmail },
          replyTo: settings.replyTo || null,
          subject: "Test email from Inflix Marketing",
          html: testEmailHtml(
            [
              "This is a test message from Inflix Marketing. If you can read it, your settings work.",
              `From: ${settings.fromName || settings.fromEmail} <${settings.fromEmail}>`,
              `Sent through: ${smtp.host}:${smtp.port}`,
            ],
            settings.companyAddress,
          ),
        },
        smtp,
      ),
      30_000,
      TIMEOUT_MESSAGE,
    );
  } catch (err) {
    const { config, message } = classifySendError(err);
    if (config || message === TIMEOUT_MESSAGE) {
      return { error: `Couldn't connect: ${message}. Check the host, port, encryption, username and password.` };
    }
    return { error: `Not sent: ${message}` };
  }

  await updateSettings({ smtp });
  return saved(`Sent to ${to.data} and settings saved. Check your inbox (and spam folder).`);
}

// ---------------------------------------------------------------------------
// Sender (+ the app's website address, used in unsubscribe links)
// ---------------------------------------------------------------------------

const senderSchema = z.object({
  fromName: z.string().trim().min(1, "Enter a sender name").max(100, "Keep the name under 100 characters"),
  fromEmail: email("Enter the email address you send from"),
  companyAddress: z.string().trim().max(500, "Keep the address under 500 characters"),
  appUrl: z
    .string()
    .trim()
    .refine((v) => {
      try {
        const url = new URL(v);
        return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
      } catch {
        return false;
      }
    }, "Enter a full address starting with https://")
    // Links are built as `${appUrl}/u/...`, so keep only origin + path.
    .transform((v) => {
      const url = new URL(v);
      return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
    }),
});

export async function saveSender(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireSession();
  const parsed = senderSchema.safeParse(fields(formData));
  if (!parsed.success) return invalid(parsed.error);
  await updateSettings(parsed.data); // reply-to is not on the page and stays as stored
  return saved();
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

const accountSchema = z
  .object({
    email: email(),
    newPassword: z
      .string()
      .refine((v) => v === "" || v.length >= MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`),
    confirm: z.string(),
    currentPassword: z.string().min(1, "Enter your current password"),
  })
  .refine((d) => d.newPassword === d.confirm, { path: ["confirm"], message: "Passwords don't match" });

export async function saveAccount(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const session = await requireSession();
  const parsed = accountSchema.safeParse(fields(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { email: newEmail, newPassword, currentPassword } = parsed.data;

  if (newEmail === session.email && !newPassword) return { error: "Nothing to change - enter a new email or password." };

  const error = await updateAccount(session.email, {
    currentPassword,
    newEmail: newEmail !== session.email ? newEmail : undefined,
    newPassword: newPassword || undefined,
  });
  if (error) {
    return error.toLowerCase().includes("current password")
      ? { fieldErrors: { currentPassword: [error] } }
      : { fieldErrors: { email: [error] } };
  }
  return saved("Account updated");
}
