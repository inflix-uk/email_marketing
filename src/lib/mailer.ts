import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import { escapeHtml, htmlToText } from "./render";
import { getSettings, type SmtpSettings } from "./settings";

// Thin wrapper around nodemailer. Works with any SMTP provider (Amazon SES,
// Resend, Brevo, Mailgun, SendGrid...). SMTP settings come from the Settings
// page; with no SMTP host it runs in "dev" mode and writes each email to
// data/outbox/*.html instead.

export interface OutgoingEmail {
  to: string;
  from: { name: string; address: string };
  replyTo?: string | null;
  subject: string;
  html: string;
  /** Plain-text part; derived from html when omitted. */
  text?: string;
  /** Send only the text part (plain-text campaigns); `html` is ignored. */
  textOnly?: boolean;
  headers?: Record<string, string>;
}

export interface SendResult {
  messageId: string;
  /** Set in dev mode: where the email was written. */
  outboxPath?: string;
}

const globalForMailer = globalThis as unknown as { mail?: { key: string; transport: Transporter } };

function transportKey(smtp: SmtpSettings, name: string | undefined): string {
  return JSON.stringify([smtp.host.trim(), smtp.port, smtp.secure, smtp.user, smtp.pass, name ?? ""]);
}

/**
 * Hostname we announce in the SMTP greeting (EHLO). nodemailer falls back to
 * the machine name, which in a container is not a real domain and becomes
 * "[127.0.0.1]" - spam filters score that. Use the public app URL's host
 * (e.g. marketing.example.com) when it is a real domain.
 */
export function smtpClientName(appUrl: string | null | undefined): string | undefined {
  let host: string;
  try {
    host = new URL(String(appUrl ?? "").trim()).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return undefined;
  if (/^\d+(\.\d+){3}$/.test(host)) return undefined;
  if (/(^|\.)(localhost|local|internal|test|invalid|example|localdomain)$/.test(host)) return undefined;
  return host;
}

/** Domain part of an address (lower-cased), or null. */
function domainOf(address: string): string | null {
  const at = address.lastIndexOf("@");
  const domain = at >= 0 ? address.slice(at + 1).trim().toLowerCase() : "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/** RFC 5322 Message-ID at the sender's own domain (never "localhost" or the machine name). */
export function makeMessageId(fromAddress: string): string {
  return `<${randomUUID()}@${domainOf(fromAddress) ?? "localhost.localdomain"}>`;
}

/**
 * The nodemailer message for an OutgoingEmail. Pure (exported for tests).
 * nodemailer builds multipart/alternative with text/plain first and text/html
 * last (the part clients prefer), UTF-8 with quoted-printable / base64 as
 * needed, and a Date header; it adds no X-Mailer header.
 */
export function toMailOptions(msg: OutgoingEmail, text: string, now: Date = new Date()): SendMailOptions {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(msg.headers ?? {})) {
    // A header value must stay on one line (no header injection).
    const clean = String(value).replace(/[\r\n]+/g, " ").trim();
    if (clean && /^[A-Za-z0-9-]+$/.test(key)) headers[key] = clean;
  }
  return {
    to: msg.to,
    from: { name: msg.from.name, address: msg.from.address },
    replyTo: msg.replyTo || undefined,
    subject: msg.subject,
    messageId: makeMessageId(msg.from.address),
    date: now,
    html: msg.textOnly ? undefined : msg.html,
    text,
    headers,
  };
}

function createTransport(smtp: SmtpSettings, pool: boolean, name?: string): Transporter {
  return nodemailer.createTransport({
    host: smtp.host.trim(),
    name,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    pool,
    maxConnections: 3,
    // nodemailer's defaults (up to 10 min) would let a hung server stall the worker.
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });
}

/** Pooled transport for the saved settings; rebuilt when they change. */
function getTransport(smtp: SmtpSettings, name: string | undefined): Transporter {
  const key = transportKey(smtp, name);
  if (globalForMailer.mail?.key !== key) {
    globalForMailer.mail?.transport.close();
    globalForMailer.mail = { key, transport: createTransport(smtp, true, name) };
  }
  return globalForMailer.mail.transport;
}

/** Close pooled SMTP connections so the process can exit cleanly. */
export function closeMailer(): void {
  globalForMailer.mail?.transport.close();
  globalForMailer.mail = undefined;
}

/**
 * Send one email with the saved SMTP settings (or `smtp` when given, e.g. to
 * test unsaved settings). In dev mode (no host) it is written to data/outbox.
 */
export async function sendEmail(msg: OutgoingEmail, smtp?: SmtpSettings): Promise<SendResult> {
  const text = msg.text ?? htmlToText(msg.html);
  const settings = await getSettings();
  const config = smtp ?? settings.smtp;
  if (!config.host.trim()) return writeToOutbox(msg, text);

  const name = smtpClientName(settings.appUrl);
  const transport = smtp ? createTransport(config, false, name) : getTransport(config, name);
  try {
    const info = await transport.sendMail(toMailOptions(msg, text));
    return { messageId: info.messageId };
  } finally {
    if (smtp) transport.close();
  }
}

async function writeToOutbox(msg: OutgoingEmail, text: string): Promise<SendResult> {
  const dir = path.join(process.cwd(), "data", "outbox");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTo = msg.to.replace(/[^a-z0-9@._-]/gi, "_");
  const file = path.join(dir, `${stamp}-${safeTo}.html`);
  const meta = [
    `From: ${msg.from.name} <${msg.from.address}>`,
    `To: ${msg.to}`,
    msg.replyTo ? `Reply-To: ${msg.replyTo}` : "",
    `Subject: ${msg.subject}`,
    ...Object.entries(msg.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
  ]
    .filter(Boolean)
    .join("\n");
  const banner = `<pre style="background:#fef3c7;border-bottom:1px solid #f59e0b;margin:0;padding:12px;font:12px monospace;white-space:pre-wrap">DEV OUTBOX - not actually sent\n${escapeHtml(meta)}</pre>`;
  const body = msg.textOnly
    ? `<pre style="white-space:pre-wrap;font:14px/1.5 monospace;padding:16px">${escapeHtml(text)}</pre>`
    : msg.html;
  await writeFile(file, `${banner}\n${body}\n<!--\n${text}\n-->\n`, "utf8");
  return { messageId: `<dev-${randomUUID()}@localhost>`, outboxPath: file };
}

/** Check SMTP connection + credentials (saved settings, or `smtp` to test unsaved ones). */
export async function verifyMailer(smtp?: SmtpSettings): Promise<{ mode: "smtp" | "dev"; ok: boolean; error?: string }> {
  const settings = await getSettings();
  const config = smtp ?? settings.smtp;
  if (!config.host.trim()) return { mode: "dev", ok: true };
  const transport = createTransport(config, false, smtpClientName(settings.appUrl));
  try {
    await transport.verify();
    return { mode: "smtp", ok: true };
  } catch (err) {
    return { mode: "smtp", ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    transport.close();
  }
}

/**
 * Decide whether a send error is worth retrying.
 * - permanent: SMTP 5xx for this recipient/message (bad address, rejected) - don't retry.
 * - config: our side is broken (auth failed, can't connect) - every send will
 *   fail the same way, so the worker should back off rather than burn retries.
 * - otherwise temporary (4xx, timeouts) - retry later.
 */
export function classifySendError(err: unknown): {
  permanent: boolean;
  config: boolean;
  message: string;
} {
  const e = err as { responseCode?: number; message?: string; code?: string };
  const message = e?.message ?? String(err);
  const code = e?.responseCode;
  const config =
    code === 530 ||
    code === 535 ||
    ["EAUTH", "ECONNECTION", "ECONNREFUSED", "ENOTFOUND", "ESOCKET", "ETLS"].includes(e?.code ?? "");
  const permanent = !config && typeof code === "number" && code >= 500;
  return { permanent, config, message };
}
