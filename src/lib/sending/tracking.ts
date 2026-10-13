// Recording what recipients do with an email: opens, clicks, unsubscribes,
// list preferences. Called from public routes, so every function tolerates
// unknown ids. Counters use single-document update pipelines, so concurrent
// hits never lose an increment and the first-open/first-click time is set
// exactly once. Works the same for campaign and automation sends (nothing
// here needs the campaign document).

import { collections } from "@/db";
import { newId, type ContactStatus } from "@/db/schema";

// Send ids are UUIDs; anything else can't exist - skip the query.
const SEND_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function isPlausibleSendId(sendId: string): boolean {
  return SEND_ID_RE.test(sendId);
}

// Opens and clicks from machines are not engagement. Security gateways and
// link scanners fetch every link (and often every image) of an incoming
// email before a person sees it, and chat apps fetch links to build previews.
// The tracking routes skip recording when the User-Agent is obviously one of
// those (clicks are still redirected). Kept deliberately small:
// - only self-identifying agents are filtered - a scanner posing as a normal
//   browser is indistinguishable and is counted;
// - image proxies of real mail apps (GoogleImageProxy, YahooMailProxy,
//   Outlook, Apple Mail) are NOT filtered: those are people opening the email;
// - a missing User-Agent is counted (some mail apps send none).
// HEAD requests are never counted (see the click route).
const BOT_USER_AGENT_RE = new RegExp(
  [
    // crawlers and link-preview fetchers
    ...["bot\\b", "crawl", "spider", "slurp", "preview", "linkexpanding", "facebookexternalhit", "whatsapp"],
    // email security gateways / link scanners
    ...["scan", "barracuda", "proofpoint", "mimecast", "symantec", "messagelabs", "trend ?micro", "forcepoint"],
    ...["fireeye", "sophos", "ironport", "zscaler", "mcafee", "urldefense", "safelinks", "mailguard", "cloudmark"],
    // scripts and HTTP libraries
    ...["curl/", "wget/", "python", "go-http-client", "java/", "libwww", "apache-httpclient", "node-fetch", "axios"],
    ...["postmanruntime", "headlesschrome", "phantomjs"],
  ].join("|"),
  "i",
);

/** True for user agents that are obviously link scanners, crawlers or scripts rather than a person. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent) && BOT_USER_AGENT_RE.test(userAgent as string);
}

const plusOne = (field: string) => ({ $add: [{ $ifNull: [field, 0] }, 1] });
const firstTime = (field: string, now: Date) => ({ $ifNull: [field, now] });

/** Open pixel hit: +1 open, first-open timestamp, contact.lastOpenedAt. Unknown ids are ignored. */
export async function recordOpen(sendId: string): Promise<void> {
  if (!isPlausibleSendId(sendId)) return;
  const { sends, contacts } = await collections();
  const now = new Date();
  const send = await sends.findOneAndUpdate(
    { _id: sendId },
    [{ $set: { openCount: plusOne("$openCount"), openedAt: firstTime("$openedAt", now), updatedAt: now } }],
    { projection: { contactId: 1 } },
  );
  if (!send) return;
  await contacts.updateOne({ _id: send.contactId }, { $set: { lastOpenedAt: now, updatedAt: now } });
}

/**
 * Tracked link click: +1 click, first-click timestamp, one clicks document.
 * A click implies an open (images may be blocked), so the open is recorded too
 * (also on the contact: lastClickedAt + lastOpenedAt).
 */
export async function recordClick(sendId: string, url: string): Promise<void> {
  if (!isPlausibleSendId(sendId)) return;
  const { sends, clicks, contacts } = await collections();
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
    { projection: { campaignId: 1, contactId: 1 } },
  );
  if (!send) return;
  await clicks.insertOne({ _id: newId(), sendId, campaignId: send.campaignId, url: url.slice(0, 2048), createdAt: now });
  await contacts.updateOne(
    { _id: send.contactId },
    { $set: { lastClickedAt: now, lastOpenedAt: now, updatedAt: now } },
  );
}

export interface UnsubscribeInfo {
  email: string;
  contactStatus: ContactStatus;
  /** The lists this contact is on, by name - for the preference page. */
  lists: { id: string; name: string }[];
}

/** The address, current status and lists behind an unsubscribe link, or null if the send/contact no longer exists. */
export async function getUnsubscribeInfo(sendId: string): Promise<UnsubscribeInfo | null> {
  if (!isPlausibleSendId(sendId)) return null;
  const { sends, contacts, lists } = await collections();
  const send = await sends.findOne({ _id: sendId }, { projection: { contactId: 1 } });
  if (!send) return null;
  const contact = await contacts.findOne({ _id: send.contactId }, { projection: { email: 1, status: 1, listIds: 1 } });
  if (!contact) return null;
  const listIds = contact.listIds ?? [];
  const rows = listIds.length
    ? await lists.find({ _id: { $in: listIds } }, { projection: { name: 1 } }).sort({ name: 1 }).toArray()
    : [];
  return {
    email: contact.email,
    contactStatus: contact.status,
    lists: rows.map((l) => ({ id: l._id, name: l.name })),
  };
}

/**
 * Preference page: take the contact behind an email off some lists. The
 * contact stays subscribed (campaigns to their other lists still reach them).
 * Returns how many lists they were removed from, or null if the send/contact
 * no longer exists. Idempotent.
 */
export async function leaveLists(sendId: string, listIds: string[]): Promise<{ left: number } | null> {
  if (!isPlausibleSendId(sendId)) return null;
  const { sends, contacts } = await collections();
  const send = await sends.findOne({ _id: sendId }, { projection: { contactId: 1 } });
  if (!send) return null;
  const ids = [...new Set(listIds.filter(Boolean))];
  const before = await contacts.findOneAndUpdate(
    { _id: send.contactId },
    { $pull: { listIds: { $in: ids } }, $set: { updatedAt: new Date() } },
    { projection: { listIds: 1 } },
  );
  if (!before) return null;
  return { left: (before.listIds ?? []).filter((id) => ids.includes(id)).length };
}

export type UnsubscribeResult = "unsubscribed" | "already" | "not_found";

/**
 * Unsubscribe the contact an email was sent to from ALL emails. Idempotent.
 * Only flips contacts that are currently "subscribed" or "pending" (a
 * bounced/complained status is kept), and credits the unsubscribe to this
 * send only when it caused it.
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
    { _id: send.contactId, status: { $in: ["subscribed", "pending"] } },
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
