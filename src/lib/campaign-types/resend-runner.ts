// Auto resend (campaign.type "resend") - database side.
//
// When the first email has finished sending and the delay is over, the worker
// re-evaluates the first email's recipients (resend-rules.ts), creates ONE
// child campaign (runKind "resend", parentId) holding the second email and
// queues it. The normal sender then sends it, re-checking each contact's
// status right before every message.
//
// Idempotent without transactions: the parent is claimed with a conditional
// update (resend.state waiting -> running, a stale claim is taken over), the
// child id is fixed in that claim, sends are unique per (campaign, contact)
// and the child only becomes "sending" once its queue is complete.

import { collections } from "@/db";
import type { CampaignDoc, SendDoc } from "@/db/schema";
import { newId } from "@/db/schema";
import { resendSendFilter } from "./resend-rules";
import { insertIgnoringDuplicates, queuedSend } from "./store";

const CHUNK = 1000;
/** A "running" claim older than this belongs to a crashed worker. */
const STALE_CLAIM_MS = 10 * 60_000;

export interface ResendLog {
  campaignId: string;
  name: string;
  queued: number;
  note: string | null;
}

export async function processDueResends(now: Date, campaignIds?: string[]): Promise<ResendLog[]> {
  const { campaigns } = await collections();
  const due = await campaigns
    .find(
      {
        ...(campaignIds ? { _id: { $in: campaignIds } } : {}),
        type: "resend",
        status: "sent",
        "resend.state": { $in: ["waiting", "running"] },
        "resend.dueAt": { $lte: now },
      },
      { projection: { _id: 1 } },
    )
    .limit(10)
    .toArray();

  const out: ResendLog[] = [];
  for (const { _id } of due) {
    const result = await runResend(_id, now);
    if (result) out.push(result);
  }
  return out;
}

async function runResend(parentId: string, now: Date): Promise<ResendLog | null> {
  const { campaigns, contacts, sends } = await collections();

  // 1. Claim (and fix the child's id on first claim).
  const claimed = await campaigns.findOneAndUpdate(
    {
      _id: parentId,
      type: "resend",
      status: "sent",
      "resend.dueAt": { $lte: now },
      $or: [
        { "resend.state": "waiting" },
        { "resend.state": "running", "resend.claimedAt": { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
      ],
    },
    [
      {
        $set: {
          "resend.state": "running",
          "resend.claimedAt": now,
          "resend.childId": { $ifNull: ["$resend.childId", newId()] },
        },
      },
    ],
    { returnDocument: "after" },
  );
  const settings = claimed?.resend;
  if (!claimed || !settings?.childId) return null;
  const childId = settings.childId;

  const finish = async (state: "done" | "skipped", count: number, note: string | null) => {
    const at = new Date();
    await campaigns.updateOne(
      { _id: parentId, "resend.state": "running", "resend.claimedAt": now },
      {
        $set: {
          "resend.state": state,
          "resend.resentAt": state === "done" ? at : null,
          "resend.resendCount": count,
          "resend.note": note,
          updatedAt: at,
        },
      },
    );
    return { campaignId: parentId, name: claimed.name, queued: count, note };
  };

  // 2. Already published by an earlier (crashed) run: just record it.
  const existing = await campaigns.findOne({ _id: childId }, { projection: { status: 1, totalRecipients: 1 } });
  if (existing && existing.status !== "draft") return finish("done", existing.totalRecipients ?? 0, null);

  // 3. The child campaign (hidden from the list; locked while its queue is built).
  if (!existing) {
    const child: CampaignDoc = {
      _id: childId,
      name: `${claimed.name} (resend)`.slice(0, 300),
      subject: settings.subject?.trim() || claimed.subject,
      previewText: settings.html ? settings.previewText : claimed.previewText,
      fromName: claimed.fromName,
      fromEmail: claimed.fromEmail,
      replyTo: claimed.replyTo,
      html: settings.html?.trim() ? settings.html : claimed.html,
      design: settings.html?.trim() ? settings.design : (claimed.design ?? null),
      templateId: settings.html?.trim() ? settings.templateId : claimed.templateId,
      // Same format as the first email; a hand-written text version only fits the same content.
      format: claimed.format ?? "html",
      textBody: settings.html?.trim() ? null : (claimed.textBody ?? null),
      textBodyFor: settings.html?.trim() ? null : (claimed.textBodyFor ?? null),
      listIds: claimed.listIds ?? [],
      segmentIds: [],
      abTest: null,
      type: "regular",
      parentId,
      runKind: "resend",
      status: "draft",
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      totalRecipients: 0,
      queueLockedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await insertIgnoringDuplicates(campaigns, [child]);
  }

  // 4. Who gets it: the first email's recipients who didn't open/click and are still subscribed.
  const cursor = sends
    .find(resendSendFilter(parentId, settings.condition), { projection: { contactId: 1 } })
    .batchSize(CHUNK);
  let batch: string[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const ids = batch;
    batch = [];
    const subscribed = await contacts
      .find({ _id: { $in: ids }, status: "subscribed" }, { projection: { _id: 1, email: 1 } })
      .toArray();
    const at = new Date();
    const docs: SendDoc[] = subscribed.map((c) => queuedSend(childId, c._id, c.email, at));
    await insertIgnoringDuplicates(sends, docs);
  };
  try {
    for await (const send of cursor) {
      batch.push(send.contactId);
      if (batch.length >= CHUNK) await flush();
    }
    await flush();
  } finally {
    await cursor.close().catch(() => {});
  }

  const total = await sends.countDocuments({ campaignId: childId });
  if (total === 0) {
    await campaigns.deleteOne({ _id: childId, status: "draft" });
    const note =
      settings.condition === "not_opened"
        ? "Not needed: everyone who can still be emailed opened the first email."
        : "Not needed: everyone who can still be emailed clicked the first email.";
    return finish("skipped", 0, note);
  }

  // 5. Publish: only now can the sender see it.
  const started = new Date();
  await campaigns.updateOne(
    { _id: childId, status: "draft" },
    {
      $set: { status: "sending", startedAt: started, totalRecipients: total, updatedAt: started },
      $unset: { queueLockedAt: "" },
    },
  );
  return finish("done", total, null);
}
