// The worker's unit operations. Guarantees:
// - never double-send: each send is claimed with an atomic single-document
//   update (queued -> sending) before it is sent, and marked "sent" right after;
// - only campaigns that are "sending" are processed, and the campaign status
//   is re-checked right before each email goes out (pause/cancel apply at once);
// - never email unsubscribed contacts: the contact's status is re-checked
//   immediately before each send;
// - survive crashes: sends left in "sending" by a dead process are re-queued;
// - respect the provider's rate limit (Settings > sending speed, re-read
//   every batch so changes apply without a restart) and the daily send limit
//   (Settings > Deliverability): at the limit the queue simply waits for the
//   next UTC day;
// - A/B tests: the winner is stored once with a conditional update, so every
//   remaining recipient gets the same subject (see ./ab);
// - mailboxes that reject the address outright are recorded as hard bounces.
//
// Automation emails are sends too, but they are sent (and recovered) by
// src/lib/automations - nothing here touches sends with kind "automation".
//
// Run ONE worker process per database: stuck-send recovery assumes no other
// process is mid-send.

import type { Filter } from "mongodb";
import { collections } from "@/db";
import type { AbTest, CampaignDoc, SendDoc } from "@/db/schema";
import { classifySendError, sendEmail, type OutgoingEmail, type SendResult } from "@/lib/mailer";
import { getSettings } from "@/lib/settings";
import { getLinkContext } from "@/lib/tokens";
import { needsWinner, pickWinner, subjectForVariant, type Variant } from "./ab";
import { mailboxRejection, recordBounce } from "./bounces";
import { CampaignError } from "./errors";
import { buildCampaignEmail, type CampaignBuildContext, type EmailContent } from "./prepare";
import { queueCampaign, queueLockFree } from "./queue";
import { remainingDailyQuota } from "./quota";
import { getVariantStats } from "./stats";

/** A "sending" send older than this belongs to a crashed process. */
export const STUCK_SEND_MS = 5 * 60_000;
/** Total delivery attempts for temporary (4xx / network) errors. */
export const MAX_ATTEMPTS = 3;
/** Wait before attempt 2 and attempt 3. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];
/** Max emails in flight at once (matches the mailer's SMTP pool size). */
const MAX_CONCURRENCY = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Spaces sends out to at most `perSecond()`; safe with concurrent callers. */
export class Pacer {
  private next = 0;
  constructor(private readonly perSecond: () => number) {}

  async wait(): Promise<void> {
    const interval = 1000 / Math.max(0.01, this.perSecond());
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + interval;
    if (at > now) await sleep(at - now);
  }
}

/** Rate from the settings, refreshed at the start of every batch. */
let currentRate = 5;
const defaultPacer = new Pacer(() => currentRate);

function sanitizeRate(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function scopeFilter<T extends { campaignId: string }>(campaignIds?: string[]): Filter<T> {
  return (campaignIds ? { campaignId: { $in: campaignIds } } : {}) as Filter<T>;
}

// ---------------------------------------------------------------------------
// Sent-but-not-recorded bookkeeping
// ---------------------------------------------------------------------------

interface SentRecord {
  messageId: string;
  sentAt: Date;
  email: string;
  attempts: number;
}

/**
 * Emails the mail server accepted but whose "sent" status couldn't be saved
 * (database briefly unavailable). Kept in memory and retried; while listed
 * they are never re-queued, so they can't be sent twice.
 */
const unrecorded = new Map<string, SentRecord>();

async function markSent(sendId: string, rec: SentRecord, tries = 3): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const { sends } = await collections();
      await sends.updateOne(
        { _id: sendId },
        {
          $set: {
            status: "sent",
            sentAt: rec.sentAt,
            messageId: rec.messageId,
            email: rec.email,
            attempts: rec.attempts,
            lastError: null,
            updatedAt: new Date(),
          },
        },
      );
      unrecorded.delete(sendId);
      return true;
    } catch (err) {
      if (i === tries - 1) {
        unrecorded.set(sendId, rec);
        console.error(`[sending] email ${sendId} was sent but could not be marked as sent (will retry):`, err);
      } else {
        await sleep(500 * (i + 1));
      }
    }
  }
  return false;
}

async function flushUnrecorded(): Promise<void> {
  for (const [sendId, rec] of unrecorded) {
    if (!(await markSent(sendId, rec, 1))) return;
  }
}

// ---------------------------------------------------------------------------
// Recovery, scheduling, finalizing
// ---------------------------------------------------------------------------

/** Re-queue sends left in "sending" by a crashed/killed worker. Returns how many. */
export async function recoverStuckSends(
  olderThanMs = STUCK_SEND_MS,
  opts: { campaignIds?: string[] } = {},
): Promise<number> {
  if (opts.campaignIds && opts.campaignIds.length === 0) return 0;
  await flushUnrecorded();
  const { sends } = await collections();
  const now = new Date();
  const filter: Filter<SendDoc> = {
    status: "sending",
    kind: { $ne: "automation" },
    updatedAt: { $lt: new Date(now.getTime() - olderThanMs) },
    ...scopeFilter<SendDoc>(opts.campaignIds),
  };
  if (unrecorded.size > 0) filter._id = { $nin: [...unrecorded.keys()] };
  const res = await sends.updateMany(filter, {
    $set: {
      status: "queued",
      nextAttemptAt: now,
      lastError: "Worker stopped while sending this email; re-queued",
      updatedAt: now,
    },
  });
  return res.modifiedCount;
}

export interface ScheduledStartResult {
  started: { id: string; name: string; queued: number }[];
  /** Couldn't be sent (missing content, no recipients...): moved back to draft. */
  reverted: { id: string; name: string; reason: string }[];
  /** Unexpected errors - left "scheduled" and retried next loop. */
  errors: { id: string; name: string; error: unknown }[];
}

/** Queue every scheduled campaign whose time has come. */
export async function startDueScheduledCampaigns(
  now: Date = new Date(),
  opts: { campaignIds?: string[] } = {},
): Promise<ScheduledStartResult> {
  const result: ScheduledStartResult = { started: [], reverted: [], errors: [] };
  if (opts.campaignIds && opts.campaignIds.length === 0) return result;

  const { campaigns } = await collections();
  const filter: Filter<CampaignDoc> = {
    status: "scheduled",
    $and: [{ $or: [{ scheduledAt: null }, { scheduledAt: { $lte: now } }] }, queueLockFree(now)],
  };
  if (opts.campaignIds) filter._id = { $in: opts.campaignIds };
  const due = await campaigns
    .find(filter, { projection: { _id: 1, name: 1, scheduledAt: 1 } })
    .sort({ scheduledAt: 1 })
    .toArray();

  for (const c of due) {
    try {
      if (!c.scheduledAt) throw new CampaignError("It is scheduled but has no send time.", "problems");
      const { queued } = await queueCampaign(c._id);
      result.started.push({ id: c._id, name: c.name, queued });
    } catch (err) {
      if (!(err instanceof CampaignError)) {
        result.errors.push({ id: c._id, name: c.name, error: err });
        continue;
      }
      // Being queued right now (e.g. "Send now" from the web app): leave it be.
      if (err.code === "busy") continue;
      // Only if still "scheduled" and nobody holds the queue lock: it may have
      // just been started or cancelled from the web app.
      const res = await campaigns.updateOne(
        { _id: c._id, status: "scheduled", queueLockedAt: null },
        { $set: { status: "draft", updatedAt: new Date() } },
      );
      if (res.modifiedCount > 0) result.reverted.push({ id: c._id, name: c.name, reason: err.message });
    }
  }
  return result;
}

/** "sending" campaigns with nothing left queued/in flight -> "sent". */
export async function finalizeCampaigns(
  opts: { campaignIds?: string[] } = {},
): Promise<{ id: string; name: string }[]> {
  if (opts.campaignIds && opts.campaignIds.length === 0) return [];
  const { campaigns, sends } = await collections();
  const filter: Filter<CampaignDoc> = { status: "sending" };
  if (opts.campaignIds) filter._id = { $in: opts.campaignIds };
  const active = await campaigns.find(filter, { projection: { _id: 1, name: 1 } }).toArray();

  const finished: { id: string; name: string }[] = [];
  for (const c of active) {
    // Served by the { campaignId, status } index. Nothing can add queued sends
    // to a "sending" campaign except this (single) worker, which isn't mid-batch.
    const pending = await sends.findOne(
      { campaignId: c._id, status: { $in: ["queued", "sending"] } },
      { projection: { _id: 1 } },
    );
    if (pending) continue;
    const now = new Date();
    const res = await campaigns.updateOne(
      { _id: c._id, status: "sending" },
      { $set: { status: "sent", completedAt: now, updatedAt: now } },
    );
    if (res.modifiedCount > 0) finished.push({ id: c._id, name: c.name });
  }
  return finished;
}

// ---------------------------------------------------------------------------
// A/B test winner
// ---------------------------------------------------------------------------

/**
 * Pick the winner of a campaign's A/B test by unique open rate (a tie, or no
 * data, goes to "A") and store it - once: the update only applies while
 * `abTest.winner` is still null, so concurrent callers and later batches all
 * end up with the same stored winner. Returns it, and whether this call made
 * the decision. Campaigns without a test answer "A".
 */
export async function decideAbWinner(campaignId: string): Promise<{ winner: Variant; decided: boolean }> {
  const { campaigns } = await collections();
  const stats = await getVariantStats(campaignId);
  if (!stats) return { winner: "A", decided: false };
  const winner = pickWinner(stats.A, stats.B);
  const now = new Date();
  const filter: Filter<CampaignDoc> = { _id: campaignId, abTest: { $type: "object" }, "abTest.winner": null };
  const res = await campaigns.updateOne(filter, {
    $set: { "abTest.winner": winner, "abTest.decidedAt": now, updatedAt: now },
  });
  if (res.modifiedCount > 0) return { winner, decided: true };
  const current = await campaigns.findOne({ _id: campaignId }, { projection: { abTest: 1 } });
  return { winner: current?.abTest?.winner === "B" ? "B" : "A", decided: false };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface ProcessBatchOptions {
  /** Max sends to pick (default: ~10 seconds' worth at the configured rate). */
  limit?: number;
  /** Checked before each send; return true to stop after the in-flight emails. */
  shouldStop?: () => boolean;
  /** Only process these campaigns (tests / targeted runs). */
  campaignIds?: string[];
  pacer?: Pacer;
}

export interface BatchResult {
  /** Queued sends picked for this batch. */
  picked: number;
  sent: number;
  failed: number;
  /** Temporary failures re-queued with backoff. */
  retried: number;
  /** Contact no longer subscribed, or campaign cancelled meanwhile. */
  skipped: number;
  /** Set when the mail server/config is broken: the worker should back off. */
  configError: string | null;
  /** Unexpected (database) errors; the batch stops at the first one. */
  errors: number;
  /** Campaigns that had sends processed. */
  campaignIds: string[];
  /** Emails were due but today's send limit (Settings > Deliverability) is used up. */
  dailyLimitReached: boolean;
  /** A/B tests whose winner was picked in this batch. */
  abDecided: { campaignId: string; winner: Variant }[];
}

type Outcome = "sent" | "failed" | "retried" | "skipped" | "errors" | "config" | "none";

type CampaignContent = EmailContent & { id: string; abTest: AbTest | null };

type Candidate = Pick<SendDoc, "_id" | "campaignId" | "variant">;

export async function processBatch(opts: ProcessBatchOptions = {}): Promise<BatchResult> {
  const result: BatchResult = {
    picked: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    skipped: 0,
    configError: null,
    errors: 0,
    campaignIds: [],
    dailyLimitReached: false,
    abDecided: [],
  };
  if (opts.campaignIds && opts.campaignIds.length === 0) return result;
  await flushUnrecorded();

  const settings = await getSettings();
  const rate = sanitizeRate(settings.sendRatePerSecond);
  currentRate = rate;
  const limit = opts.limit ?? Math.min(500, Math.max(10, Math.ceil(rate * 10)));

  const { campaigns, sends } = await collections();

  // Campaigns that may be sent right now (never one still being queued).
  const campaignFilter: Filter<CampaignDoc> = { status: "sending", queueLockedAt: null };
  if (opts.campaignIds) campaignFilter._id = { $in: opts.campaignIds };
  const active = await campaigns
    .find(campaignFilter, {
      projection: { _id: 1, subject: 1, previewText: 1, html: 1, fromName: 1, fromEmail: 1, replyTo: 1, abTest: 1 },
    })
    .toArray();
  if (active.length === 0) return result;
  const content = new Map<string, CampaignContent>(
    active.map((c) => [
      c._id,
      {
        id: c._id,
        subject: c.subject,
        previewText: c.previewText,
        html: c.html,
        fromName: c.fromName,
        fromEmail: c.fromEmail,
        replyTo: c.replyTo,
        abTest: c.abTest ?? null,
      },
    ]),
  );

  let candidates: Candidate[] = await sends
    .find(
      { status: "queued", nextAttemptAt: { $lte: new Date() }, campaignId: { $in: [...content.keys()] } },
      { projection: { _id: 1, campaignId: 1, variant: 1 } },
    )
    .sort({ nextAttemptAt: 1, _id: 1 })
    .limit(limit)
    .toArray();
  if (candidates.length === 0) return result;

  // Daily send limit: send only what is left of today's allowance. At the
  // limit nothing is claimed - the queue stays as it is until tomorrow (UTC).
  const quota = await remainingDailyQuota();
  if (quota <= 0) {
    result.dailyLimitReached = true;
    return result;
  }
  if (candidates.length > quota) candidates = candidates.slice(0, quota);
  result.picked = candidates.length;

  // A/B tests: the first held-back (non-test) send has come due - pick the winner now.
  for (const item of candidates) {
    const campaign = content.get(item.campaignId);
    if (!campaign || !needsWinner(campaign.abTest, item.variant)) continue;
    const { winner, decided } = await decideAbWinner(campaign.id);
    campaign.abTest = { ...campaign.abTest!, winner };
    if (decided) result.abDecided.push({ campaignId: campaign.id, winner });
  }

  // Signed-link context + footer address, once per batch.
  const build: CampaignBuildContext = { links: await getLinkContext(), companyAddress: settings.companyAddress };

  const pacer = opts.pacer ?? defaultPacer;
  const touched = new Set<string>();
  /** Campaigns paused/cancelled during this batch: their remaining sends are left alone. */
  const halted = new Set<string>();
  let next = 0;
  const stop = () => result.configError !== null || result.errors > 0 || (opts.shouldStop?.() ?? false);

  const lane = async () => {
    while (!stop()) {
      const item = candidates[next++];
      if (!item) return;
      const campaign = content.get(item.campaignId);
      if (!campaign || halted.has(campaign.id)) continue;
      const outcome = await processOne(item, campaign, build, pacer, stop, {
        onConfigError: (message) => {
          result.configError ??= message;
        },
        onCampaignHalted: (id) => halted.add(id),
      });
      if (outcome === "none" || outcome === "config") continue;
      result[outcome]++;
      if (outcome !== "errors") touched.add(item.campaignId);
    }
  };
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Math.ceil(rate), candidates.length));
  await Promise.all(Array.from({ length: concurrency }, lane));

  result.campaignIds = [...touched];
  return result;
}

/** Claim, check, send and record one email. Never throws. */
async function processOne(
  item: Candidate,
  campaign: CampaignContent,
  build: CampaignBuildContext,
  pacer: Pacer,
  stop: () => boolean,
  events: { onConfigError: (message: string) => void; onCampaignHalted: (campaignId: string) => void },
): Promise<Outcome> {
  const sendId = item._id;
  let claimed: Pick<SendDoc, "attempts" | "contactId"> | null = null;
  let delivered = false;
  try {
    const { campaigns, contacts, sends } = await collections();

    // 1. Claim: only one process can move a send from queued to sending.
    //    `updatedAt` doubles as the claim time for stuck-send recovery.
    claimed = await sends.findOneAndUpdate(
      { _id: sendId, status: "queued" },
      { $set: { status: "sending", updatedAt: new Date() } },
      { projection: { attempts: 1, contactId: 1 } },
    );
    if (!claimed) return "none";
    const attempts = (claimed.attempts ?? 0) + 1;

    // 2. The contact may have unsubscribed (or bounced) since the campaign was queued.
    const contact = await contacts.findOne(
      { _id: claimed.contactId },
      { projection: { email: 1, firstName: 1, lastName: 1, fields: 1, status: 1 } },
    );
    if (!contact || contact.status !== "subscribed") {
      await finish(sendId, { status: "skipped", lastError: `Contact ${contact?.status ?? "deleted"}` });
      return "skipped";
    }

    // 3. Build the message (A/B tests: with this send's subject line).
    let message: OutgoingEmail;
    try {
      const subject = subjectForVariant(campaign.subject, campaign.abTest, item.variant);
      message = buildCampaignEmail({ ...campaign, subject }, { ...contact, fields: contact.fields ?? {} }, sendId, build);
    } catch (err) {
      await finish(sendId, { status: "failed", attempts, lastError: `Could not build the email: ${errorMessage(err)}` });
      return "failed";
    }

    // 4. Rate limit. If asked to stop meanwhile, hand the send back untouched.
    await pacer.wait();
    if (stop()) {
      await finish(sendId, { status: "queued" });
      return "none";
    }

    // 5. Last check: the campaign may have been paused or cancelled since the
    //    batch started.
    const state = await campaigns.findOne({ _id: campaign.id }, { projection: { status: 1 } });
    if (state?.status !== "sending") {
      events.onCampaignHalted(campaign.id);
      if (state?.status === "paused") await finish(sendId, { status: "queued" });
      else await finish(sendId, { status: "skipped", lastError: `Campaign ${state?.status ?? "deleted"}` });
      return "none";
    }

    // 6. Send.
    let sent: SendResult;
    try {
      sent = await sendEmail(message);
    } catch (err) {
      const { permanent, config, message: reason } = classifySendError(err);
      if (config) {
        // Our side is broken (auth, DNS, connection): don't burn this contact's attempts.
        await finish(sendId, { status: "queued", lastError: `Mail server problem: ${reason}` });
        events.onConfigError(reason);
        return "config";
      }
      if (permanent || attempts >= MAX_ATTEMPTS) {
        await finish(sendId, { status: "failed", attempts, lastError: reason });
        // "No such mailbox": a hard bounce - stop emailing this address.
        const bounce = permanent ? mailboxRejection(err) : null;
        if (bounce) {
          await recordBounce({ email: contact.email, reason: bounce, sendId }).catch((e) =>
            console.error(`[sending] could not record the bounce of email ${sendId}:`, e),
          );
        }
        return "failed";
      }
      await finish(sendId, {
        status: "queued",
        attempts,
        lastError: reason,
        nextAttemptAt: retryAt(attempts),
      });
      return "retried";
    }

    // 7. Record. From here on the email is out: never re-queue it.
    delivered = true;
    const sentAt = new Date();
    await markSent(sendId, { messageId: sent.messageId, sentAt, email: contact.email, attempts });
    // Engagement timestamp for segments ("not emailed in 30 days"); best effort.
    await contacts
      .updateOne({ _id: claimed.contactId }, { $set: { lastEmailedAt: sentAt, updatedAt: sentAt } })
      .catch(() => {});
    return "sent";
  } catch (err) {
    console.error(`[sending] unexpected error on email ${sendId}:`, err);
    // Not claimed: the database itself is failing - stop the batch.
    // (After delivery nothing can throw: markSent handles its own errors.)
    if (!claimed || delivered) return "errors";
    // Claimed but not sent: count it as an attempt so a "poison" send ends up
    // failed instead of looping forever. If even this update fails, the send
    // stays "sending" and recoverStuckSends() re-queues it later.
    const attempts = (claimed.attempts ?? 0) + 1;
    const lastError = `Internal error: ${errorMessage(err)}`;
    try {
      if (attempts >= MAX_ATTEMPTS) {
        await finish(sendId, { status: "failed", attempts, lastError });
        return "failed";
      }
      await finish(sendId, { status: "queued", attempts, lastError, nextAttemptAt: retryAt(attempts) });
      return "retried";
    } catch {
      return "errors";
    }
  }
}

/** Update a claimed ("sending") send. */
async function finish(
  sendId: string,
  set: Partial<Pick<SendDoc, "status" | "attempts" | "lastError" | "nextAttemptAt">>,
): Promise<void> {
  const { sends } = await collections();
  await sends.updateOne({ _id: sendId, status: "sending" }, { $set: { ...set, updatedAt: new Date() } });
}

/** When to try again after `attempts` failed attempts. */
function retryAt(attempts: number): Date {
  const delay = RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1];
  return new Date(Date.now() + delay);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
