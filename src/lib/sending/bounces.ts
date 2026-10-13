// Hard bounces and spam complaints. They arrive from the email provider's
// webhook (src/app/api/webhooks) or, for servers that reject unknown
// mailboxes straight away, from the SMTP error at send time.
//
// A bounced/complained contact is never emailed again (the audience filter
// and the worker's pre-send check both require status "subscribed").
// Everything here is idempotent: providers retry and repeat notifications.

import { collections } from "@/db";
import type { SendDoc } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { normalizeEmail } from "@/lib/utils";
import { BOUNCE_PAUSE_IGNORED } from "./queue";
import { getCampaignStats, type CampaignStats } from "./stats";

export interface BounceInput {
  email: string;
  /** Why it bounced (the provider's diagnostic text). */
  reason?: string | null;
  /** Message-ID of the email, when the provider reports it - finds the exact send. */
  messageId?: string | null;
  /** The send itself, when the caller knows it (rejections at send time). */
  sendId?: string | null;
}

export interface BounceResult {
  /** The contact's status was changed by this call. */
  contactUpdated: boolean;
  /** The send that was marked by this call (null when none matched or it was marked before). */
  sendId: string | null;
}

/** A hard bounce: the address doesn't exist (any more). Contact -> "bounced". */
export function recordBounce(input: BounceInput): Promise<BounceResult> {
  return record("bounced", input);
}

/** The recipient marked an email as spam. Contact -> "complained". */
export function recordComplaint(input: Omit<BounceInput, "reason">): Promise<BounceResult> {
  return record("complained", { ...input, reason: "Marked the email as spam" });
}

type MatchedSend = Pick<SendDoc, "_id" | "campaignId" | "kind">;

/** The send a notification is about: by id, by Message-ID, else the latest email sent to the address. */
async function findSend(email: string, input: BounceInput): Promise<MatchedSend | null> {
  const { sends } = await collections();
  const projection = { _id: 1, campaignId: 1, kind: 1 };
  if (input.sendId) return sends.findOne({ _id: input.sendId }, { projection });

  const messageId = input.messageId?.trim();
  if (messageId) {
    // Stored as "<id@host>"; providers report it with or without the brackets.
    const bare = messageId.replace(/^<|>$/g, "");
    const byId = await sends.findOne({ messageId: { $in: [messageId, bare, `<${bare}>`] } }, { projection });
    if (byId) return byId;
  }
  return sends.find({ email, status: "sent" }, { projection }).sort({ sentAt: -1 }).limit(1).next();
}

async function record(status: "bounced" | "complained", input: BounceInput): Promise<BounceResult> {
  const email = normalizeEmail(input.email ?? "");
  if (!email) return { contactUpdated: false, sendId: null };
  const { contacts, sends } = await collections();
  const now = new Date();

  // Only contacts we would still email: an unsubscribe (or an earlier bounce) is kept as it is.
  const contact = await contacts.updateOne(
    { email, status: { $in: ["subscribed", "pending"] } },
    { $set: { status, bouncedAt: now, bounceReason: input.reason?.trim().slice(0, 500) || null, updatedAt: now } },
  );

  let sendId: string | null = null;
  const send = await findSend(email, input);
  if (send) {
    // The "not set yet" condition makes repeats no-ops.
    const marked = await sends.updateOne(
      status === "bounced" ? { _id: send._id, bouncedAt: null } : { _id: send._id, complainedAt: null },
      { $set: status === "bounced" ? { bouncedAt: now, updatedAt: now } : { complainedAt: now, updatedAt: now } },
    );
    if (marked.modifiedCount > 0) {
      sendId = send._id;
      if (status === "bounced" && send.kind !== "automation") {
        // Never let the pause check fail the notification itself.
        const paused = await pauseCampaignIfBouncing(send.campaignId).catch((err) => {
          console.error("[sending] bounce-rate check failed", err);
          return null;
        });
        if (paused) console.warn(`[sending] campaign "${paused.name}" (${paused.id.slice(0, 8)}) paused - ${paused.reason}`);
      }
    }
  }
  return { contactUpdated: contact.modifiedCount > 0, sendId };
}

// ---------------------------------------------------------------------------
// Rejections at send time
// ---------------------------------------------------------------------------

const MAILBOX_STATUSES = new Set(["5.1.1", "5.1.10"]);

const USER_UNKNOWN_RE =
  /(user|mailbox|recipient|address|account|addressee)[^.\n]{0,60}(unknown|not found|doesn'?t exist|does not exist|not exist|invalid)|no such (user|mailbox|recipient|address|account)|unknown (user|mailbox|recipient|address)|invalid (recipient|mailbox)/i;

// Anything hinting that the rejection is about us (sender, relay, policy,
// reputation, authentication) or is temporary (quota, rate): not a bounce.
const NOT_THE_MAILBOX_RE =
  /\bsender\b|\bfrom address\b|relay|spam|polic|block|blacklist|reputation|dmarc|\bspf\b|dkim|authenticat|not authori[sz]ed|unauthori[sz]ed|quota|mailbox full|over ?limit|rate limit|too many|greylist|try again/i;

/**
 * Is this SMTP error a permanent rejection that is clearly about the
 * recipient's mailbox ("no such user")? Returns the server's response (the
 * bounce reason) or null.
 *
 * Deliberately conservative - wrongly marking a contact as bounced loses a
 * subscriber, while a missed one only costs another failed send:
 * - a 5xx reply with enhanced status 5.1.1 (bad mailbox) or 5.1.10
 *   (recipient not found / null MX);
 * - 5.1.0, or a 550 without any enhanced status, only when the text says
 *   "user unknown" / "no such mailbox" / ...;
 * - never when the text mentions the sender, relaying, policy, spam,
 *   authentication or quota - those are config, content or temporary problems.
 */
export function mailboxRejection(err: unknown): string | null {
  const e = (err ?? {}) as {
    responseCode?: unknown;
    response?: unknown;
    message?: unknown;
    rejectedErrors?: unknown;
  };
  // nodemailer reports rejected recipients on `rejectedErrors` (we send to one address at a time).
  const first = Array.isArray(e.rejectedErrors) && e.rejectedErrors.length === 1 ? e.rejectedErrors[0] : null;
  const code = Number(e.responseCode ?? first?.responseCode);
  if (!Number.isInteger(code) || code < 500 || code > 599 || code === 530 || code === 535) return null;

  const text = [e.response, first?.response, e.message].find((v) => typeof v === "string" && v.trim()) as
    | string
    | undefined;
  if (!text || NOT_THE_MAILBOX_RE.test(text)) return null;

  const status = /(?:^|[\s:])5\d\d[ -](5\.\d{1,3}\.\d{1,3})(?!\d|\.\d)/.exec(text)?.[1] ?? null;
  const reason = text.replace(/\s+/g, " ").trim().slice(0, 500);
  if (status && MAILBOX_STATUSES.has(status)) return reason;
  if (status === "5.1.0" || (status === null && code === 550)) return USER_UNKNOWN_RE.test(text) ? reason : null;
  return null;
}

// ---------------------------------------------------------------------------
// Auto-pause on a high bounce rate
// ---------------------------------------------------------------------------

/** The bounce rate is only judged once this many emails have been attempted. */
export const BOUNCE_PAUSE_MIN_SENDS = 50;

type BounceCounts = Pick<CampaignStats, "sent" | "failed" | "bounced">;

/** Hard bounces as a percentage of the emails attempted so far (sent + failed). */
export function bounceRatePercent(stats: BounceCounts): number {
  const attempted = stats.sent + stats.failed;
  return attempted > 0 ? (stats.bounced / attempted) * 100 : 0;
}

/** True when a campaign should be paused: enough emails attempted and the rate is above the limit (0 = off). */
export function exceedsBounceLimit(stats: BounceCounts, limitPercent: unknown): boolean {
  const limit = Number(limitPercent);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  if (stats.sent + stats.failed < BOUNCE_PAUSE_MIN_SENDS) return false;
  return bounceRatePercent(stats) > limit;
}

export interface AutoPause {
  id: string;
  name: string;
  /** Bounce rate in percent at the time of the pause. */
  rate: number;
  reason: string;
}

/**
 * Pause a "sending" campaign whose bounce rate is above
 * settings.bouncePauseRate, storing why in `pauseReason`. A high bounce rate
 * ruins the sender reputation quickly, so stop and let a person look. Returns
 * what was paused, or null. Pass `stats` when they were just computed.
 */
export async function pauseCampaignIfBouncing(campaignId: string, stats?: CampaignStats): Promise<AutoPause | null> {
  const limit = Number((await getSettings()).bouncePauseRate);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const { campaigns } = await collections();

  // Atomic claim (below) only for campaigns still sending that nobody chose to resume regardless.
  const filter = { _id: campaignId, status: "sending" as const, [BOUNCE_PAUSE_IGNORED]: { $ne: true } };
  if (!stats) {
    if (!(await campaigns.findOne(filter, { projection: { _id: 1 } }))) return null;
    stats = await getCampaignStats(campaignId);
  }
  // Nothing left to send (it is about to be marked "sent"): pausing would protect nothing.
  if (stats.queued === 0 || !exceedsBounceLimit(stats, limit)) return null;

  const rate = Math.round(bounceRatePercent(stats) * 10) / 10;
  const reason =
    `Paused automatically: ${rate}% of the emails bounced (${stats.bounced} of ${stats.sent + stats.failed}), ` +
    `above the ${limit}% limit. Clean the list before resuming.`;
  const now = new Date();
  const paused = await campaigns.findOneAndUpdate(
    filter,
    { $set: { status: "paused", pauseReason: reason, updatedAt: now } },
    { projection: { name: 1 } },
  );
  return paused ? { id: campaignId, name: paused.name, rate, reason } : null;
}
