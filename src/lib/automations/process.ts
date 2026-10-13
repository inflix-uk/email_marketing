// Sends the automation emails that are due. Called by the worker on every
// tick. Guarantees:
// - one process per enrolment: an enrolment is claimed with a single atomic
//   update that pushes its nextRunAt forward as a lease, so two workers (or two
//   overlapping ticks) can never work on the same person at the same time;
// - never the same step twice: the send document for (step, contact) is
//   created BEFORE the email goes out and is unique on that pair. A retry after
//   a crash finds it and only moves the enrolment on when it is already "sent";
// - never email someone who isn't "subscribed": the contact is re-read right
//   before each email, and anyone else has their enrolment stopped;
// - only "active" automations send. Paused / draft ones keep their enrolments
//   waiting, and a pause applies to the very next email;
// - the daily send limit and the sending speed from Settings are respected.
//
// Automation emails are ordinary `sends` (kind "automation", campaignId =
// automationSendKey(...)), so tracking, unsubscribe links and stats work
// exactly as they do for campaigns.
//
// Crash recovery is entirely ours: the campaign sender's recoverStuckSends()
// skips kind "automation". A send left in "sending" (or "queued") by a dead
// process is found again through its enrolment once the lease runs out, and is
// taken over by whoever then holds that enrolment (step 5 below).

import { collections, isDuplicateKeyError } from "@/db";
import { automationSendKey, newId, type EnrollmentDoc, type SendDoc } from "@/db/schema";
import { classifySendError, sendEmail, type OutgoingEmail, type SendResult } from "@/lib/mailer";
import {
  buildCampaignEmail,
  mailboxRejection,
  Pacer,
  recordBounce,
  remainingDailyQuota,
  type CampaignBuildContext,
} from "@/lib/sending";
import { getSettings } from "@/lib/settings";
import { getLinkContext } from "@/lib/tokens";
import { advanceAfterStep, failureAction, retryDelayMs } from "./logic";

/**
 * How long a claimed enrolment is hidden from other workers. If the process
 * dies mid-way, the enrolment simply becomes due again after this long.
 * Longer than any single send can take (SMTP timeouts are ~1 minute).
 */
export const ENROLLMENT_LEASE_MS = 5 * 60_000;
/** Wait before trying again when the mail server itself is misconfigured or down. */
const CONFIG_RETRY_MS = 60_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
/** Max emails in flight at once (matches the mailer's SMTP pool size). */
const MAX_CONCURRENCY = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Rate from the settings, refreshed at the start of every run. */
let currentRate = 5;
const pacer = new Pacer(() => currentRate);

function sanitizeRate(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Sent-but-not-recorded bookkeeping (same idea as the campaign sender)
// ---------------------------------------------------------------------------

interface SentRecord {
  messageId: string;
  sentAt: Date;
  email: string;
  attempts: number;
}

/**
 * Emails the mail server accepted but whose "sent" status couldn't be saved
 * (database briefly unavailable). While listed here they are never sent again
 * by this process; the status is written as soon as the database is back.
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
        console.error(`[automations] email ${sendId} was sent but could not be marked as sent (will retry):`, err);
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
// The run
// ---------------------------------------------------------------------------

interface Run {
  /** Emails this run may still send today (Infinity = no daily limit). */
  budget: number;
  sent: number;
  /** Set to stop picking further enrolments (limit reached, mail server down, database error). */
  halted: boolean;
  build: CampaignBuildContext;
  signal?: AbortSignal;
  /** Resolves when `signal` aborts, so waiting for a rate-limit slot can be cut short. */
  aborted: Promise<void> | null;
}

/**
 * Send the automation emails that are due. Called by the worker loop on every
 * tick. Returns the number of emails sent. Must respect the daily send limit
 * and stop promptly when `signal` aborts.
 */
export async function processDueAutomations(opts?: { limit?: number; signal?: AbortSignal }): Promise<number> {
  const signal = opts?.signal;
  if (signal?.aborted) return 0;

  let run: Run | null = null;
  let onAbort: (() => void) | null = null;
  try {
    await flushUnrecorded();
    const { automations, enrollments } = await collections();

    // Only automations that are switched on. Enrolments of paused / draft ones stay untouched.
    const active = await automations.find({ status: "active" }, { projection: { _id: 1 } }).toArray();
    if (active.length === 0) return 0;

    const budget = await remainingDailyQuota();
    if (!(budget > 0)) return 0;

    const requested = Number(opts?.limit);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(MAX_LIMIT, Math.floor(requested)) : DEFAULT_LIMIT;
    const due = await enrollments
      .find(
        { status: "active", nextRunAt: { $lte: new Date() }, automationId: { $in: active.map((a) => a._id) } },
        { projection: { _id: 1 } },
      )
      .sort({ nextRunAt: 1, _id: 1 })
      .limit(limit)
      .toArray();
    if (due.length === 0) return 0;

    const settings = await getSettings();
    const rate = sanitizeRate(settings.sendRatePerSecond);
    currentRate = rate;

    const state: Run = {
      budget,
      sent: 0,
      halted: false,
      // Signed-link context + footer address, once per run.
      build: { links: await getLinkContext(), companyAddress: settings.companyAddress },
      signal,
      aborted: null,
    };
    run = state;
    if (signal) {
      state.aborted = new Promise<void>((resolve) => {
        onAbort = () => resolve();
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) resolve();
      });
    }

    let next = 0;
    const lane = async () => {
      while (!state.halted && !signal?.aborted) {
        const item = due[next++];
        if (!item) return;
        await processEnrollment(item._id, state);
      }
    };
    const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Math.ceil(rate), due.length));
    await Promise.all(Array.from({ length: concurrency }, lane));
    return state.sent;
  } catch (err) {
    console.error("[automations] could not process due automations:", err);
    return run?.sent ?? 0;
  } finally {
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** Claim one enrolment and send its next step. Never throws. */
async function processEnrollment(enrollmentId: string, run: Run): Promise<void> {
  let claimed = false;
  let reserved = false;
  let attempted = false;
  try {
    // 0. Rate limit first, so nothing is held while waiting for a slot.
    await (run.aborted ? Promise.race([pacer.wait(), run.aborted]) : pacer.wait());
    if (run.halted || run.signal?.aborted) return;

    const { automations, contacts, enrollments, sends } = await collections();

    // 1. Claim: move nextRunAt forward as a lease. Only one process can do this
    //    for a due enrolment; everyone else's filter no longer matches.
    const claimedAt = new Date();
    const lease = new Date(claimedAt.getTime() + ENROLLMENT_LEASE_MS);
    const enrollment = await enrollments.findOneAndUpdate(
      { _id: enrollmentId, status: "active", nextRunAt: { $lte: claimedAt } },
      { $set: { nextRunAt: lease, updatedAt: claimedAt } },
      { returnDocument: "before" },
    );
    if (!enrollment) return;
    claimed = true;

    /** Update the enrolment, but only while we still hold the lease. */
    const settle = async (set: Partial<Pick<EnrollmentDoc, "status" | "stepIndex" | "nextRunAt">>) => {
      await enrollments.updateOne(
        { _id: enrollmentId, status: "active", nextRunAt: lease },
        { $set: { ...set, updatedAt: new Date() } },
      );
    };
    /** Hand the enrolment back untouched: it is due again straight away. */
    const release = () => settle({ nextRunAt: enrollment.nextRunAt });

    // 2. The automation, read fresh: it may have been paused, edited or deleted.
    const automation = await automations.findOne({ _id: enrollment.automationId });
    if (!automation) {
      await settle({ status: "stopped" });
      return;
    }
    if (automation.status !== "active") {
      await release();
      return;
    }
    const steps = automation.steps ?? [];
    const step = steps[enrollment.stepIndex];
    if (!step) {
      // Steps were removed while this person was waiting: nothing left to send.
      await settle({ status: "completed" });
      return;
    }
    const advance = async () => {
      const move = advanceAfterStep(steps, enrollment.stepIndex, new Date());
      await settle(
        move.status === "completed"
          ? { status: "completed", stepIndex: move.stepIndex }
          : { stepIndex: move.stepIndex, nextRunAt: move.nextRunAt },
      );
    };

    // 3. The contact may have unsubscribed, bounced or been deleted since enrolling.
    const contact = await contacts.findOne(
      { _id: enrollment.contactId },
      { projection: { email: 1, firstName: 1, lastName: 1, fields: 1, status: 1 } },
    );
    if (!contact || contact.status !== "subscribed") {
      // An earlier attempt of this step may be waiting for a retry: it will never be sent now.
      await sends.updateOne(
        {
          campaignId: automationSendKey(automation._id, step.id),
          contactId: enrollment.contactId,
          status: { $in: ["queued", "sending"] },
        },
        { $set: { status: "skipped", lastError: `Contact ${contact?.status ?? "deleted"}`, updatedAt: new Date() } },
      );
      await settle({ status: "stopped" });
      return;
    }

    // 4. Daily send limit: reserve one email from this run's budget.
    if (run.budget <= 0) {
      run.halted = true;
      await release();
      return;
    }
    run.budget--;
    reserved = true;

    // 5. The send document comes first. It is unique per (step, contact), so a
    //    step can never be sent twice - not by a retry, not after a crash.
    const key = automationSendKey(automation._id, step.id);
    const now = new Date();
    let sendId = newId();
    let attempts = 1;
    try {
      await sends.insertOne({
        _id: sendId,
        campaignId: key,
        kind: "automation",
        automationId: automation._id,
        contactId: contact._id,
        email: contact.email,
        status: "sending",
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        messageId: null,
        sentAt: null,
        openedAt: null,
        clickedAt: null,
        unsubscribedAt: null,
        openCount: 0,
        clickCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const existing = await sends.findOne(
        { campaignId: key, contactId: contact._id },
        { projection: { status: 1, attempts: 1 } },
      );
      if (!existing) {
        // Deleted between the insert and the read: try again on the next tick.
        await release();
        return;
      }
      sendId = existing._id;
      const pending = unrecorded.get(sendId);
      if (pending) await markSent(sendId, pending, 1);
      if (pending || existing.status === "sent" || existing.status === "failed" || existing.status === "skipped") {
        // Already dealt with (sent earlier, or failed for good): move on without sending.
        await advance();
        return;
      }
      // An earlier attempt was interrupted or is waiting for its retry. We hold
      // the enrolment, so this send is ours to take.
      const taken = await sends.findOneAndUpdate(
        { _id: sendId, status: { $in: ["queued", "sending"] } },
        { $set: { status: "sending", updatedAt: new Date() } },
        { projection: { attempts: 1 } },
      );
      if (!taken) {
        await release();
        return;
      }
      attempts = (taken.attempts ?? 0) + 1;
    }

    /** Update the send we hold (status "sending"). */
    const finishSend = async (set: Partial<Pick<SendDoc, "status" | "attempts" | "lastError" | "nextAttemptAt">>) => {
      await sends.updateOne({ _id: sendId, status: "sending" }, { $set: { ...set, updatedAt: new Date() } });
    };

    // 6. Build the message exactly like a campaign email: merge tags, tracked
    //    links, open pixel, unsubscribe link + List-Unsubscribe headers.
    let message: OutgoingEmail;
    try {
      message = buildCampaignEmail(
        {
          subject: step.subject,
          previewText: step.previewText,
          html: step.html,
          fromName: automation.fromName,
          fromEmail: automation.fromEmail,
          replyTo: automation.replyTo,
        },
        { email: contact.email, firstName: contact.firstName, lastName: contact.lastName, fields: contact.fields ?? {} },
        sendId,
        run.build,
      );
    } catch (err) {
      await finishSend({ status: "failed", attempts, lastError: `Could not build the email: ${errorMessage(err)}` });
      await advance();
      return;
    }

    // 7. Send.
    attempted = true;
    let result: SendResult;
    try {
      result = await sendEmail(message);
    } catch (err) {
      const { permanent, config, message: reason } = classifySendError(err);
      if (config) {
        // Our side is broken (auth, DNS, connection): don't burn this person's
        // attempts, and stop the run - every other email would fail the same way.
        attempted = false;
        run.halted = true;
        console.error(`[automations] mail server problem, pausing automation emails for a minute: ${reason}`);
        await finishSend({ status: "queued", lastError: `Mail server problem: ${reason}` });
        await settle({ nextRunAt: new Date(Date.now() + CONFIG_RETRY_MS) });
        return;
      }
      if (failureAction({ permanent, attempts }) === "fail") {
        await finishSend({ status: "failed", attempts, lastError: reason });
        // "No such mailbox": a hard bounce. The contact becomes "bounced", is
        // never emailed again, and leaves the series here.
        const bounce = permanent ? mailboxRejection(err) : null;
        if (bounce) {
          await recordBounce({ email: contact.email, reason: bounce, sendId }).catch((e) =>
            console.error(`[automations] could not record the bounce of email ${sendId}:`, e),
          );
          await settle({ status: "stopped" });
          return;
        }
        // Any other failure: give up on this step and carry on with the rest of the series.
        await advance();
        return;
      }
      const retryAt = new Date(Date.now() + retryDelayMs(attempts));
      await finishSend({ status: "queued", attempts, lastError: reason, nextAttemptAt: retryAt });
      await settle({ nextRunAt: retryAt });
      return;
    }

    // 8. Record. From here on the email is out: it must never be sent again.
    run.sent++;
    const sentAt = new Date();
    await markSent(sendId, { messageId: result.messageId, sentAt, email: contact.email, attempts });
    try {
      await contacts.updateOne({ _id: contact._id }, { $set: { lastEmailedAt: sentAt, updatedAt: sentAt } });
    } catch (err) {
      console.error(`[automations] could not update lastEmailedAt for contact ${contact._id}:`, err);
    }

    // 9. Next step after its delay, or done. If this fails the lease runs out,
    //    the retry finds the "sent" send above and advances without sending.
    await advance();
  } catch (err) {
    console.error(`[automations] unexpected error on enrolment ${enrollmentId}:`, err);
    // Not even claimed: the database itself is failing - stop this run.
    // A claimed enrolment is retried when its lease runs out.
    if (!claimed) run.halted = true;
  } finally {
    // Nothing went out: give the reserved email back to the daily budget.
    if (reserved && !attempted) run.budget++;
  }
}
