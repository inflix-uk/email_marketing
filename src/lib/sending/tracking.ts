// Recording what recipients do with an email: opens, clicks, unsubscribes.
// Called from public routes, so every function tolerates unknown ids.
// Counters use single-document update pipelines, so concurrent hits never
// lose an increment and the first-open/first-click time is set exactly once.

import { collections } from "@/db";
import { newId, type ContactStatus } from "@/db/schema";

// Send ids are UUIDs; anything else can't exist - skip the query.
const SEND_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function isPlausibleSendId(sendId: string): boolean {
  return SEND_ID_RE.test(sendId);
}

const plusOne = (field: string) => ({ $add: [{ $ifNull: [field, 0] }, 1] });
const firstTime = (field: string, now: Date) => ({ $ifNull: [field, now] });

/** Open pixel hit: +1 open, first-open timestamp. Unknown ids are ignored. */
export async function recordOpen(sendId: string): Promise<void> {
  if (!isPlausibleSendId(sendId)) return;
  const { sends } = await collections();
  const now = new Date();
  await sends.updateOne({ _id: sendId }, [
    { $set: { openCount: plusOne("$openCount"), openedAt: firstTime("$openedAt", now), updatedAt: now } },
  ]);
}

/**
 * Tracked link click: +1 click, first-click timestamp, one clicks document.
 * A click implies an open (images may be blocked), so the open is recorded too.
 */
export async function recordClick(sendId: string, url: string): Promise<void> {
  if (!isPlausibleSendId(sendId)) return;
  const { sends, clicks } = await collections();
  const now = new Date();
  const send = await sends.findOneAndUpdate(
    { _id: sendId },
    [
      {
        $set: {
          clickCount: plusOne("$clickCount"),
          clickedAt: firstTime("$clickedAt", now),
          openedAt: firstTime("$openedAt", now),
          openCount: { $max: [{ $ifNull: ["$openCount", 0] }, 1] },
          updatedAt: now,
        },
      },
    ],
    { projection: { campaignId: 1 } },
  );
  if (!send) return;
  await clicks.insertOne({ _id: newId(), sendId, campaignId: send.campaignId, url: url.slice(0, 2048), createdAt: now });
}

export interface UnsubscribeInfo {
  email: string;
  contactStatus: ContactStatus;
}

/** The address + current status behind an unsubscribe link, or null if the send/contact no longer exists. */
export async function getUnsubscribeInfo(sendId: string): Promise<UnsubscribeInfo | null> {
  if (!isPlausibleSendId(sendId)) return null;
  const { sends, contacts } = await collections();
  const send = await sends.findOne({ _id: sendId }, { projection: { contactId: 1 } });
  if (!send) return null;
  const contact = await contacts.findOne({ _id: send.contactId }, { projection: { email: 1, status: 1 } });
  return contact ? { email: contact.email, contactStatus: contact.status } : null;
}

export type UnsubscribeResult = "unsubscribed" | "already" | "not_found";

/**
 * Unsubscribe the contact an email was sent to. Idempotent. Only flips
 * contacts that are currently "subscribed" (a bounced/complained status is
 * kept), and credits the unsubscribe to this send only when it caused it.
 * Other queued sends to the contact are skipped by the worker's pre-send check.
 */
export async function unsubscribeBySend(sendId: string): Promise<UnsubscribeResult> {
  if (!isPlausibleSendId(sendId)) return "not_found";
  const { sends, contacts } = await collections();
  const send = await sends.findOne({ _id: sendId }, { projection: { contactId: 1 } });
  if (!send) return "not_found";

  const now = new Date();
  // The contact update is the claim: of concurrent requests (one-click POST
  // + the page), exactly one flips the status and credits this send.
  const changed = await contacts.updateOne(
    { _id: send.contactId, status: "subscribed" },
    { $set: { status: "unsubscribed", unsubscribedAt: now, updatedAt: now } },
  );
  if (changed.modifiedCount === 0) return "already";
  await sends.updateOne({ _id: sendId, unsubscribedAt: null }, { $set: { unsubscribedAt: now, updatedAt: now } });
  return "unsubscribed";
}

/** "jane.doe@example.com" -> "j******e@example.com" */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}*${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 6))}${local[local.length - 1]}${domain}`;
}
