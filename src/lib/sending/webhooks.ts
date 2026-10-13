// Bounce / complaint notifications from email providers, turned into one
// common shape. Pure functions (unit-tested); the HTTP side is
// src/app/api/webhooks/[provider]/route.ts.
//
// Only PERMANENT failures count as bounces. Soft/transient bounces (mailbox
// full, temporary outage) and every other event type are understood and
// ignored - the provider retries those deliveries itself.

import { isValidEmail, normalizeEmail } from "@/lib/utils";

export const WEBHOOK_PROVIDERS = ["ses", "resend", "brevo", "mailgun", "generic"] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

export function isWebhookProvider(value: string): value is WebhookProvider {
  return (WEBHOOK_PROVIDERS as readonly string[]).includes(value);
}

export interface FeedbackEvent {
  type: "bounce" | "complaint";
  /** Normalized (lower-cased) recipient address. */
  email: string;
  reason?: string;
  messageId?: string;
}

export type ParsedWebhook =
  | {
      ok: true;
      events: FeedbackEvent[];
      /** Amazon SNS subscription handshake: fetch this URL to start receiving notifications. */
      confirmUrl?: string;
    }
  | { ok: false; error: string };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const lower = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");
const obj = (v: unknown): Json => (isObject(v) ? v : {});

/** "Jane <jane@example.com>" or "jane@example.com" -> "jane@example.com" (null if not an address). */
function address(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const email = normalizeEmail(/<([^<>]+)>\s*$/.exec(raw)?.[1] ?? raw);
  return isValidEmail(email) ? email : null;
}

function event(type: FeedbackEvent["type"], to: unknown, reason?: unknown, messageId?: unknown): FeedbackEvent[] {
  const email = address(to);
  if (!email) return [];
  const e: FeedbackEvent = { type, email };
  const r = str(reason);
  if (r) e.reason = r.slice(0, 500);
  const id = str(messageId);
  if (id) e.messageId = id;
  return [e];
}

const done = (events: FeedbackEvent[]): ParsedWebhook => ({ ok: true, events });

/** Parse a provider's webhook body (already JSON-decoded). */
export function parseWebhook(provider: WebhookProvider, body: unknown): ParsedWebhook {
  // Some providers batch events into an array.
  if (Array.isArray(body)) {
    const events: FeedbackEvent[] = [];
    for (const item of body.slice(0, 1000)) {
      const parsed = parseWebhook(provider, item);
      if (!parsed.ok) return parsed;
      events.push(...parsed.events);
    }
    return done(events);
  }
  if (!isObject(body)) return { ok: false, error: "Expected a JSON object" };
  switch (provider) {
    case "ses":
      return parseSes(body);
    case "resend":
      return parseResend(body);
    case "brevo":
      return parseBrevo(body);
    case "mailgun":
      return parseMailgun(body);
    case "generic":
      return parseGeneric(body);
  }
}

/** Only Amazon's own hosts may be fetched to confirm an SNS subscription. */
export function isAmazonUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.toLowerCase().endsWith(".amazonaws.com");
  } catch {
    return false;
  }
}

/**
 * Amazon SES through an SNS topic. The body is the SNS envelope
 * ({ Type, Message: "<json>" }), or the SES message itself when the
 * subscription uses raw message delivery.
 */
function parseSes(body: Json): ParsedWebhook {
  const type = str(body.Type);
  if (type === "SubscriptionConfirmation") {
    const url = str(body.SubscribeURL);
    if (!url || !isAmazonUrl(url)) return { ok: false, error: "SubscribeURL is not an amazonaws.com address" };
    return { ok: true, events: [], confirmUrl: url };
  }
  if (type === "UnsubscribeConfirmation") return done([]);

  let message: unknown = body;
  if (type === "Notification") {
    if (typeof body.Message !== "string") return done([]);
    try {
      message = JSON.parse(body.Message);
    } catch {
      return done([]); // not an SES notification (e.g. a test message published to the topic)
    }
  }
  if (!isObject(message)) return done([]);

  // "notificationType" (identity notifications) or "eventType" (configuration-set event publishing).
  const kind = lower(message.notificationType ?? message.eventType);
  const messageId = obj(message.mail).messageId;
  const events: FeedbackEvent[] = [];
  if (kind === "bounce") {
    const bounce = obj(message.bounce);
    if (lower(bounce.bounceType) !== "permanent") return done([]); // Transient / Undetermined
    for (const r of Array.isArray(bounce.bouncedRecipients) ? bounce.bouncedRecipients : []) {
      const rec = obj(r);
      const reason = str(rec.diagnosticCode) ?? [str(bounce.bounceType), str(bounce.bounceSubType)].filter(Boolean).join(" / ");
      events.push(...event("bounce", rec.emailAddress, reason, messageId));
    }
  } else if (kind === "complaint") {
    const complaint = obj(message.complaint);
    for (const r of Array.isArray(complaint.complainedRecipients) ? complaint.complainedRecipients : []) {
      events.push(...event("complaint", obj(r).emailAddress, undefined, messageId));
    }
  }
  return done(events);
}

/** Resend: { type: "email.bounced" | "email.complained", data: { to: [..], email_id, bounce: { type, message } } }. */
function parseResend(body: Json): ParsedWebhook {
  const type = lower(body.type);
  const data = obj(body.data);
  const recipients = Array.isArray(data.to) ? data.to : [data.to];
  if (type === "email.bounced") {
    const bounce = obj(data.bounce);
    const bounceType = lower(bounce.type);
    // Resend reports permanent bounces here; skip anything explicitly temporary.
    if (bounceType && bounceType !== "permanent") return done([]);
    const reason = str(bounce.message) ?? str(bounce.subType);
    return done(recipients.flatMap((to) => event("bounce", to, reason, data.email_id)));
  }
  if (type === "email.complained") {
    return done(recipients.flatMap((to) => event("complaint", to, undefined, data.email_id)));
  }
  return done([]);
}

/** Brevo (transactional webhook): { event, email, reason, "message-id" }. */
function parseBrevo(body: Json): ParsedWebhook {
  const kind = lower(body.event);
  const messageId = body["message-id"];
  if (kind === "hard_bounce" || kind === "blocked" || kind === "invalid_email") {
    return done(event("bounce", body.email, str(body.reason) ?? kind.replace("_", " "), messageId));
  }
  if (kind === "spam" || kind === "complaint") return done(event("complaint", body.email, undefined, messageId));
  return done([]); // soft_bounce, deferred, delivered, opened...
}

/** Mailgun: { signature, "event-data": { event: "failed" | "complained", severity, recipient, ... } }. */
function parseMailgun(body: Json): ParsedWebhook {
  const data = obj(body["event-data"] ?? body);
  const kind = lower(data.event);
  const messageId = obj(obj(data.message).headers)["message-id"];
  if (kind === "failed") {
    if (lower(data.severity) !== "permanent") return done([]); // temporary: Mailgun retries
    const status = obj(data["delivery-status"]);
    return done(event("bounce", data.recipient, str(status.message) ?? str(status.description) ?? data.reason, messageId));
  }
  if (kind === "complained") return done(event("complaint", data.recipient, undefined, messageId));
  return done([]);
}

/** Anything else: { type: "bounce" | "complaint", email, reason?, messageId? }. */
function parseGeneric(body: Json): ParsedWebhook {
  const type = lower(body.type);
  if (type !== "bounce" && type !== "complaint") {
    return { ok: false, error: 'Expected "type" to be "bounce" or "complaint"' };
  }
  const events = event(type, body.email, type === "bounce" ? body.reason : undefined, body.messageId);
  if (events.length === 0) return { ok: false, error: 'Expected "email" to be a valid email address' };
  return done(events);
}
