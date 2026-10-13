// Campaign state transitions. Every transition is an atomic single-document
// update conditioned on the current status, so the web app and the worker can
// never both act on the same campaign (e.g. "Send now" clicked while the
// schedule comes due). No multi-document transactions: this must also work
// on a standalone mongod.

import type { Filter } from "mongodb";
import { collections, isDuplicateKeyError } from "@/db";
import { newId, type CampaignDoc, type CampaignStatus, type SendDoc } from "@/db/schema";
import { isValidEmail } from "@/lib/utils";
import { abHoldbackMs, createAbAssigner, hasAbTest } from "./ab";
import { CampaignError } from "./errors";
import { audienceRecipientsFilter, countRecipients } from "./recipients";

/** Sends inserted per insertMany call while building the queue. */
const INSERT_CHUNK = 1000;
/**
 * A queue lock older than this belongs to a crashed/killed process and may be
 * taken over. The owner refreshes it after every chunk, so only a dead (or
 * frozen) owner lets it go stale. Re-running a queue build is idempotent.
 */
export const QUEUE_LOCK_STALE_MS = 10 * 60_000;

/**
 * Problems preventing a send (empty array = ready). Human-readable, suitable
 * for a bullet list in the UI.
 */
export async function getCampaignProblems(campaignId: string): Promise<string[]> {
  const { campaigns } = await collections();
  const campaign = await campaigns.findOne({ _id: campaignId });
  if (!campaign) return ["Campaign not found"];

  const problems: string[] = [];
  if (!campaign.subject?.trim()) problems.push("Add a subject line");

  const from = campaign.fromEmail?.trim() ?? "";
  if (!from) problems.push("Add a sender (from) email address");
  else if (!isValidEmail(from)) problems.push(`The from email address "${from}" is not valid`);

  const replyTo = campaign.replyTo?.trim();
  if (replyTo && !isValidEmail(replyTo)) problems.push(`The reply-to address "${replyTo}" is not valid`);

  if (!campaign.html?.trim()) problems.push("The email content is empty");

  if (campaign.abTest && !hasAbTest(campaign.abTest)) {
    problems.push("Add the second subject line for the A/B test, or turn the test off");
  }

  const listIds = campaign.listIds ?? [];
  const segmentIds = campaign.segmentIds ?? [];
  if (listIds.length === 0 && segmentIds.length === 0) {
    problems.push("Choose at least one list or segment to send to");
  } else if ((await countRecipients(listIds, segmentIds)) === 0) {
    problems.push(NO_RECIPIENTS);
  }
  return problems;
}

const NO_RECIPIENTS = "The selected lists and segments have no subscribed contacts";

function problemsMessage(problems: string[]): string {
  return problems.length === 1
    ? `${problems[0]}.`
    : `This campaign can't be sent yet: ${problems.join("; ")}.`;
}

function statusMessage(status: CampaignStatus | undefined, action: string): string {
  switch (status) {
    case undefined:
      return "Campaign not found.";
    case "draft":
      return `This campaign is still a draft, so it can't be ${action}.`;
    case "scheduled":
      return `This campaign is scheduled, so it can't be ${action}.`;
    case "sending":
      return `This campaign is already sending, so it can't be ${action}.`;
    case "paused":
      return `This campaign is paused, so it can't be ${action}. Resume or cancel it instead.`;
    case "sent":
      return `This campaign has already been sent, so it can't be ${action}.`;
    case "cancelled":
      return `This campaign was cancelled, so it can't be ${action}.`;
  }
}

async function currentStatus(campaignId: string): Promise<CampaignStatus | undefined> {
  const { campaigns } = await collections();
  const row = await campaigns.findOne({ _id: campaignId }, { projection: { status: 1 } });
  return row?.status;
}

/**
 * Campaign field (not in CampaignDoc yet): true once someone resumed a
 * campaign that had been auto-paused for its bounce rate.
 */
export const BOUNCE_PAUSE_IGNORED = "bouncePauseIgnored";

/** Filter part: nobody is queueing this campaign (no lock, or a stale one). */
export function queueLockFree(now: Date = new Date()): Filter<CampaignDoc> {
  return {
    $or: [{ queueLockedAt: null }, { queueLockedAt: { $lt: new Date(now.getTime() - QUEUE_LOCK_STALE_MS) } }],
  };
}

/**
 * draft|scheduled -> sending. Creates one queued send per subscribed contact
 * in the campaign's audience (lists + segments), then flips the campaign to
 * "sending". With an A/B test, the test group is queued for now (variant
 * "A"/"B") and everyone else (variant null) for after the wait - see ./ab.
 *
 * Without transactions, crash safety comes from:
 * 1. a claim: `queueLockedAt` is set atomically while the status is still
 *    draft/scheduled, so only one caller builds the queue (a stale lock from a
 *    crashed process is taken over after QUEUE_LOCK_STALE_MS);
 * 2. idempotent inserts: sends are unique on {campaignId, contactId};
 * 3. the worker only processes campaigns whose status is "sending", which is
 *    set - together with removing the lock - after the queue is complete. It
 *    never sees a half-built queue.
 */
export async function queueCampaign(campaignId: string): Promise<{ queued: number }> {
  const problems = await getCampaignProblems(campaignId);
  if (problems.length > 0) throw new CampaignError(problemsMessage(problems), "problems");

  const { campaigns, contacts, sends } = await collections();

  // 1. Claim.
  let lockedAt = new Date();
  const claimed = await campaigns.findOneAndUpdate(
    { _id: campaignId, status: { $in: ["draft", "scheduled"] }, ...queueLockFree(lockedAt) },
    { $set: { queueLockedAt: lockedAt, updatedAt: lockedAt } },
    { returnDocument: "after", projection: { listIds: 1, segmentIds: 1, abTest: 1 } },
  );
  if (!claimed) {
    const current = await campaigns.findOne({ _id: campaignId }, { projection: { status: 1, queueLockedAt: 1 } });
    if (current && (current.status === "draft" || current.status === "scheduled")) {
      throw new CampaignError("This campaign is being started right now. Refresh in a moment.", "busy");
    }
    throw new CampaignError(statusMessage(current?.status, "sent now"));
  }

  // Refresh the lock (heartbeat). False = another process took it over.
  const holdsLock = async (): Promise<boolean> => {
    const next = new Date();
    const res = await campaigns.updateOne(
      { _id: campaignId, queueLockedAt: lockedAt, status: { $in: ["draft", "scheduled"] } },
      { $set: { queueLockedAt: next } },
    );
    if (res.matchedCount === 0) return false;
    lockedAt = next;
    return true;
  };
  const releaseLock = () =>
    campaigns.updateOne({ _id: campaignId, queueLockedAt: lockedAt }, { $unset: { queueLockedAt: "" } });
  const LOST = Symbol("lost lock");

  try {
    // Leftovers of an earlier run that crashed half-way. A draft/scheduled
    // campaign has never been sending, so nothing in its queue went out -
    // rebuild it from the current audience (the lists may have changed since).
    await sends.deleteMany({ campaignId, status: "queued" });

    // 2. Stream the audience into the queue.
    const now = new Date();
    const audience = await audienceRecipientsFilter(claimed.listIds ?? [], claimed.segmentIds ?? []);
    // A/B test: pick the test group while streaming; the rest waits for the winner.
    const abTest = hasAbTest(claimed.abTest) ? claimed.abTest : null;
    const assign = abTest
      ? createAbAssigner({
          total: await contacts.countDocuments(audience),
          testPercent: abTest.testPercent,
          seed: campaignId,
        })
      : null;
    const afterTest = abTest ? new Date(now.getTime() + abHoldbackMs(abTest)) : now;
    const cursor = contacts.find(audience, { projection: { _id: 1, email: 1 } }).batchSize(INSERT_CHUNK);
    let chunk: SendDoc[] = [];
    const flush = async () => {
      if (chunk.length === 0) return;
      await insertIgnoringDuplicates(sends, chunk);
      chunk = [];
      if (!(await holdsLock())) throw LOST;
    };
    try {
      for await (const contact of cursor) {
        const send = newSend(campaignId, contact._id, contact.email, now);
        if (assign) {
          send.variant = assign();
          if (send.variant === null) send.nextAttemptAt = afterTest;
        }
        chunk.push(send);
        if (chunk.length >= INSERT_CHUNK) await flush();
      }
      await flush();
    } finally {
      await cursor.close().catch(() => {});
    }

    const total = await sends.countDocuments({ campaignId });
    if (total === 0) {
      throw new CampaignError(`${NO_RECIPIENTS}.`, "problems");
    }

    // 3. Publish: only now can the worker see it.
    const started = new Date();
    const published = await campaigns.updateOne(
      { _id: campaignId, status: { $in: ["draft", "scheduled"] }, queueLockedAt: lockedAt },
      {
        $set: {
          status: "sending",
          startedAt: started,
          completedAt: null,
          totalRecipients: total,
          pauseReason: null,
          updatedAt: started,
          // A fresh test: no winner yet (matters for campaigns copied from a finished one).
          ...(claimed.abTest ? { "abTest.winner": null, "abTest.decidedAt": null } : {}),
        },
        $unset: { queueLockedAt: "" },
      },
    );
    if (published.matchedCount === 0) throw LOST;
    return { queued: total };
  } catch (err) {
    if (err !== LOST) {
      // Still ours: drop the partial queue (a retry would rebuild it anyway),
      // then let the next attempt in.
      await sends.deleteMany({ campaignId, status: "queued" }).catch(() => {});
      await releaseLock().catch(() => {});
      throw err;
    }
    // The campaign changed under us (cancelled/deleted) or a stale-lock
    // takeover happened: don't leave an orphaned queue behind.
    const status = await cleanUpAbandonedQueue(campaignId);
    throw status === "draft" || status === "scheduled"
      ? new CampaignError("This campaign has just been started by someone else.", "busy")
      : new CampaignError(statusMessage(status, "sent now"));
  }
}

function newSend(campaignId: string, contactId: string, email: string, now: Date): SendDoc {
  return {
    _id: newId(),
    campaignId,
    kind: "campaign",
    contactId,
    email,
    status: "queued",
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
  };
}

type SendsCollection = Awaited<ReturnType<typeof collections>>["sends"];

/** insertMany that treats "already queued" (unique campaignId+contactId) as success. */
async function insertIgnoringDuplicates(sends: SendsCollection, docs: SendDoc[]): Promise<void> {
  try {
    await sends.insertMany(docs, { ordered: false });
  } catch (err) {
    if (!onlyDuplicateKeyErrors(err)) throw err;
  }
}

function onlyDuplicateKeyErrors(err: unknown): boolean {
  const e = err as { writeErrors?: unknown; writeConcernError?: unknown; code?: number };
  if (e?.writeConcernError) return false;
  if (e?.writeErrors !== undefined) {
    const list = Array.isArray(e.writeErrors) ? e.writeErrors : [e.writeErrors];
    return list.length > 0 && list.every((w) => isDuplicateKeyError(w));
  }
  return isDuplicateKeyError(err);
}

/**
 * The queue was (partly) built but the campaign changed under us: deleted,
 * or cancelled while scheduled. Don't leave queued sends behind. Returns the
 * campaign's current status.
 */
async function cleanUpAbandonedQueue(campaignId: string): Promise<CampaignStatus | undefined> {
  const { campaigns, sends } = await collections();
  const campaign = await campaigns.findOne({ _id: campaignId }, { projection: { status: 1 } });
  if (!campaign) {
    await sends.deleteMany({ campaignId, status: "queued" });
  } else if (campaign.status === "cancelled") {
    await skipQueuedSends(campaignId, "Campaign cancelled", new Date());
  }
  // Still draft/scheduled: another caller took over the (stale) lock and
  // owns the queue now - leave it alone.
  return campaign?.status;
}

/** sending -> paused. Emails already handed to the mail server can't be recalled. */
export async function pauseCampaign(campaignId: string): Promise<void> {
  const { campaigns } = await collections();
  const res = await campaigns.updateOne(
    { _id: campaignId, status: "sending" },
    { $set: { status: "paused", pauseReason: null, updatedAt: new Date() } },
  );
  if (res.matchedCount === 0) throw new CampaignError(statusMessage(await currentStatus(campaignId), "paused"));
}

/**
 * paused -> sending, clearing `pauseReason`. Resuming a campaign the system
 * paused (high bounce rate) is an explicit decision to carry on, so it is
 * remembered in `bouncePauseIgnored` and that campaign isn't auto-paused again.
 */
export async function resumeCampaign(campaignId: string): Promise<void> {
  const { campaigns } = await collections();
  // One pipeline update: every expression reads the document as it was before.
  const res = await campaigns.updateOne({ _id: campaignId, status: "paused" }, [
    {
      $set: {
        status: "sending",
        [BOUNCE_PAUSE_IGNORED]: {
          $or: [{ $eq: [`$${BOUNCE_PAUSE_IGNORED}`, true] }, { $ne: [{ $ifNull: ["$pauseReason", null] }, null] }],
        },
        pauseReason: null,
        updatedAt: new Date(),
      },
    },
  ]);
  if (res.matchedCount === 0) {
    const status = await currentStatus(campaignId);
    throw new CampaignError(
      status === "sending" ? "This campaign is already sending." : statusMessage(status, "resumed"),
    );
  }
}

/**
 * scheduled|sending|paused -> cancelled. Still-queued sends become "skipped".
 * The worker re-checks the campaign status right before each send, so an
 * email it had already picked up is skipped too (unless it was already being
 * handed to the mail server).
 */
export async function cancelCampaign(campaignId: string): Promise<void> {
  const { campaigns } = await collections();
  const now = new Date();
  const res = await campaigns.updateOne(
    { _id: campaignId, status: { $in: ["scheduled", "sending", "paused"] } },
    { $set: { status: "cancelled", updatedAt: now } },
  );
  if (res.matchedCount === 0) throw new CampaignError(statusMessage(await currentStatus(campaignId), "cancelled"));
  await skipQueuedSends(campaignId, "Campaign cancelled", now);
}

async function skipQueuedSends(campaignId: string, reason: string, now: Date): Promise<void> {
  const { sends } = await collections();
  await sends.updateMany(
    { campaignId, status: "queued" },
    { $set: { status: "skipped", lastError: reason, updatedAt: now } },
  );
}
