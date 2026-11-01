// Recording what recipients do with an email: opens, clicks, unsubscribes,
// list preferences. Called from public routes, so every function tolerates
// unknown ids. Counters use single-document update pipelines, so concurrent
// hits never lose an increment and the first-open/first-click time is set
// exactly once. Works the same for campaign and automation sends (nothing
// here needs the campaign document).

import { collections } from "@/db";
import { newId, type ContactStatus } from "@/db/schema";
import { classifyHit, trimUserAgent, type HitFlags } from "@/lib/reports/user-agent";

// Send ids are UUIDs; anything else can't exist - skip the query.
const SEND_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function isPlausibleSendId(sendId: string): boolean {
  return SEND_ID_RE.test(sendId);
}

// Opens and clicks from machines are not engagement. Security gateways and
// link scanners fetch every link (and often every image) of an incoming
// email before a person sees it, and chat apps fetch links to build previews.
// Hits whose User-Agent is obviously one of those are still recorded but
// flagged `suspectedBot` (reports can hide them; they never update the
// contact). Kept deliberately small:
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

const keep = (field: string) => ({ $ifNull: [field, 0] });

/** Open events stored per email (the counters keep counting after that). */
const MAX_OPEN_EVENTS_PER_SEND = 100;

/** What the tracking route knows about the request. */
export interface HitMeta {
  userAgent?: string | null;
  /** ISO country code from a trusted proxy header (countryFromHeaders), else null. */
  country?: string | null;
}

/**
 * Bot / proxy flags of a hit on this send, or null when the send doesn't exist.
 * Everything is recorded (reports show raw numbers by default); suspected
 * bots are flagged so the report can hide them.
 */
async function hitFlags(sendId: string, meta: HitMeta, now: Date): Promise<HitFlags | null> {
  const { sends } = await collections();
  const send = await sends.findOne({ _id: sendId }, { projection: { sentAt: 1 } });
  if (!send) return null;
  return classifyHit({
    userAgent: meta.userAgent,
    knownBot: isBotUserAgent(meta.userAgent),
    sentAt: send.sentAt ?? null,
    now,
  });
}

/**
 * Open pixel hit: +1 open, first-open timestamp, one opens event (user agent,
 * country, bot flags) and - for people - contact.lastOpenedAt. Unique opens
 * come from send.openedAt, so repeated hits never count a person twice.
 * Unknown ids are ignored.
 */
export async function recordOpen(sendId: string, meta: HitMeta = {}): Promise<void> {
  if (!isPlausibleSendId(sendId)) return;
  const now = new Date();
  const flags = await hitFlags(sendId, meta, now);
  if (!flags) return;
  const machine = flags.suspectedBot || flags.privacyProxy;
  const { sends, contacts, opens } = await collections();
  const before = await sends.findOneAndUpdate(
    { _id: sendId },
    [
      {
        $set: {
          openCount: plusOne("$openCount"),
          botOpenCount: machine ? plusOne("$botOpenCount") : keep("$botOpenCount"),
          openedAt: firstTime("$openedAt", now),
          lastActivityAt: now,
          updatedAt: now,
        },
      },
    ],
    { projection: { campaignId: 1, contactId: 1, openCount: 1 } },
  );
  if (!before) return;
  if ((before.openCount ?? 0) < MAX_OPEN_EVENTS_PER_SEND) {
    await opens.insertOne({
      _id: newId(),
      sendId,
      campaignId: before.campaignId,
      userAgent: trimUserAgent(meta.userAgent),
      country: meta.country ?? null,
      suspectedBot: flags.suspectedBot,
      privacyProxy: flags.privacyProxy,
      createdAt: now,
    });
  }
  if (!flags.suspectedBot) {
    await contacts.updateOne({ _id: before.contactId }, { $set: { lastOpenedAt: now, updatedAt: now } });
  }
}

/**
 * Tracked link click: +1 click, first-click timestamp, one clicks document
 * (user agent, country, bot flag). A click implies an open (images may be
 * blocked), so the open is recorded too (also on the contact - for people
 * only - lastClickedAt + lastOpenedAt).
 */
export async function recordClick(sendId: string, url: string, meta: HitMeta = {}): Promise<void> {
  if (!isPlausibleSendId(sendId)) return;
  const now = new Date();
  const flags = await hitFlags(sendId, meta, now);
  if (!flags) return;
  const bot = flags.suspectedBot;
  const noOpenYet = { $eq: [{ $ifNull: ["$openCount", 0] }, 0] };
  // A person clicking implies a person opened. If every open so far came from
  // a bot or Apple's privacy proxy, count one more (human) open - otherwise
  // "Hide suspected bots" would show a clicker who never opened (CTOR > 100%).
  const noHumanOpenYet = { $lte: [{ $subtract: [{ $ifNull: ["$openCount", 0] }, keep("$botOpenCount")] }, 0] };
  const { sends, clicks, contacts } = await collections();
  const send = await sends.findOneAndUpdate(
    { _id: sendId },
    [
      {
        $set: {
          clickCount: plusOne("$clickCount"),
          botClickCount: bot ? plusOne("$botClickCount") : keep("$botClickCount"),
          clickedAt: firstTime("$clickedAt", now),
          openedAt: firstTime("$openedAt", now),
          // The open implied by a bot click is a bot open too.
          botOpenCount: bot ? { $add: [keep("$botOpenCount"), { $cond: [noOpenYet, 1, 0] }] } : keep("$botOpenCount"),
          openCount: bot
            ? { $max: [{ $ifNull: ["$openCount", 0] }, 1] }
            : { $add: [{ $ifNull: ["$openCount", 0] }, { $cond: [noHumanOpenYet, 1, 0] }] },
          lastActivityAt: now,
          updatedAt: now,
        },
      },
    ],
    { projection: { campaignId: 1, contactId: 1 } },
  );
  if (!send) return;
  await clicks.insertOne({
    _id: newId(),
    sendId,
    campaignId: send.campaignId,
    url: url.slice(0, 2048),
    userAgent: trimUserAgent(meta.userAgent),
    country: meta.country ?? null,
    suspectedBot: bot,
    createdAt: now,
  });
  if (!bot) {
    await contacts.updateOne(
      { _id: send.contactId },
      { $set: { lastClickedAt: now, lastOpenedAt: now, updatedAt: now } },
    );
  }
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
