// RSS series (campaign.type "rss") - fetching feeds and running the series.
//
// An active series is a campaign with status "sending" and no sends of its own.
// On every run (rss.nextRunAt) the worker:
//   1. claims the series (rss.runningAt, a stale claim is taken over),
//   2. fetches the feed and keeps only posts newer than the cursor,
//   3. no new posts -> no email, just moves nextRunAt on,
//   4. otherwise creates a child campaign (runKind "rss", parentId) with the
//      posts baked into its html and queues it like a normal campaign (frozen
//      audience snapshot, suppression re-checked at send time),
//   5. advances the cursor.
// The child's id is derived from the series and the posts, so a crash between
// 4 and 5 re-uses the same child instead of emailing the posts twice.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { collections } from "@/db";
import type { CampaignDoc } from "@/db/schema";
import { CampaignError } from "@/lib/sending/errors";
import { queueCampaign } from "@/lib/sending/queue";
import {
  advanceCursor,
  applyRssItems,
  FeedError,
  parseFeed,
  safeHttpUrl,
  selectNewItems,
  type ParsedFeed,
} from "./rss-feed";
import { nextRunAfter } from "./rss-schedule";
import { deterministicId, errorMessage, insertIgnoringDuplicates } from "./store";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const NOT_PUBLIC = "That address isn't reachable from the internet.";
const STALE_RUN_MS = 15 * 60_000;
/** After a feed error, try again this soon (or at the next scheduled time if sooner). */
const ERROR_RETRY_MS = 60 * 60_000;

/** Addresses that point back into the server's own network. */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h.includes(":")) return h === "::1" || h === "::" || /^(fc|fd|fe80:|::ffff:)/.test(h);
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * A host name can point at a private address too (e.g. a DNS name for
 * 127.0.0.1): resolve it and refuse when any address is private.
 */
async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isPrivateHost(host)) throw new FeedError(NOT_PUBLIC);
  if (isIP(host)) return;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new FeedError("The feed couldn't be reached.");
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateHost(a.address))) throw new FeedError(NOT_PUBLIC);
}

/** Check a feed address typed by a person. Returns the normalised URL or an error message. */
export function checkFeedUrl(raw: string): { url: string } | { error: string } {
  const url = safeHttpUrl(raw);
  if (!url) return { error: "Enter the full feed address, starting with https://" };
  if (isPrivateHost(new URL(url).hostname)) return { error: NOT_PUBLIC };
  return { url };
}

/** Download and parse a feed. Throws FeedError with a plain message. */
export async function fetchFeed(raw: string): Promise<ParsedFeed> {
  const checked = checkFeedUrl(raw);
  if ("error" in checked) throw new FeedError(checked.error);
  // Redirects are followed by hand so every hop's address is checked before it is requested.
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = checked.url;
  let res: Response;
  for (let hop = 0; ; hop++) {
    await assertPublicHost(new URL(url).hostname);
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal,
        headers: {
          "user-agent": "InflixMarketing-RSS/1.0",
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        },
      });
    } catch (err) {
      const timedOut = (err as { name?: string })?.name === "TimeoutError";
      throw new FeedError(timedOut ? "The feed took too long to answer." : "The feed couldn't be reached.");
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new FeedError("The feed redirects too many times.");
    let next: string | null = null;
    try {
      next = safeHttpUrl(new URL(location, url).toString());
    } catch {
      next = null;
    }
    if (!next) throw new FeedError("The feed redirects to an address that can't be read.");
    url = next;
  }
  if (!res.ok) throw new FeedError(`The feed answered with an error (HTTP ${res.status}).`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_FEED_BYTES) throw new FeedError("The feed is too big.");
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_FEED_BYTES) throw new FeedError("The feed is too big.");
  const feed = parseFeed(new TextDecoder("utf-8").decode(body));
  if (feed.items.length === 0) throw new FeedError("The feed has no posts yet.");
  return feed;
}

export interface RssRunLog {
  seriesId: string;
  name: string;
  outcome: "sent" | "no-new-posts" | "error";
  posts: number;
  queued: number;
  error: string | null;
}

export async function processDueRssSeries(now: Date, campaignIds?: string[]): Promise<RssRunLog[]> {
  const { campaigns } = await collections();
  const due = await campaigns
    .find(
      {
        ...(campaignIds ? { _id: { $in: campaignIds } } : {}),
        type: "rss",
        status: "sending",
        "rss.nextRunAt": { $lte: now },
      },
      { projection: { _id: 1 } },
    )
    .limit(5)
    .toArray();
  const out: RssRunLog[] = [];
  for (const { _id } of due) {
    const log = await runSeries(_id, now);
    if (log) out.push(log);
  }
  return out;
}

async function runSeries(seriesId: string, now: Date): Promise<RssRunLog | null> {
  const { campaigns } = await collections();
  const series = await campaigns.findOneAndUpdate(
    {
      _id: seriesId,
      type: "rss",
      status: "sending",
      "rss.nextRunAt": { $lte: now },
      $or: [{ "rss.runningAt": null }, { "rss.runningAt": { $lt: new Date(now.getTime() - STALE_RUN_MS) } }],
    },
    { $set: { "rss.runningAt": now } },
    { returnDocument: "after" },
  );
  const rss = series?.rss;
  if (!series || !rss) return null;
  const next = nextRunAfter(now, rss);
  const log = (outcome: RssRunLog["outcome"], posts = 0, queued = 0, error: string | null = null): RssRunLog => ({
    seriesId,
    name: series.name,
    outcome,
    posts,
    queued,
    error,
  });
  const release = (set: Record<string, unknown>) =>
    campaigns.updateOne(
      { _id: seriesId, "rss.runningAt": now },
      { $set: { "rss.runningAt": null, "rss.lastCheckedAt": new Date(), updatedAt: new Date(), ...set } },
    );

  // 2. Fetch.
  let feed: ParsedFeed;
  try {
    feed = await fetchFeed(rss.feedUrl);
  } catch (err) {
    const message = err instanceof FeedError ? err.message : `The feed couldn't be read: ${errorMessage(err)}`;
    const retry = new Date(Math.min(now.getTime() + ERROR_RETRY_MS, next.getTime()));
    await release({ "rss.lastError": message, "rss.nextRunAt": retry });
    return log("error", 0, 0, message);
  }

  const cursor = { seenIds: rss.seenIds ?? [], lastItemAt: rss.lastItemAt ?? null };
  const items = selectNewItems(feed.items, cursor, rss.itemCount);

  // 3. Nothing new: no email.
  if (items.length === 0) {
    await release({ "rss.lastError": null, "rss.nextRunAt": next });
    return log("no-new-posts");
  }

  // 4. The run's own campaign (same posts -> same id).
  const childId = deterministicId(`${seriesId}:rss:${items.map((i) => i.id).join("\n")}`);
  const created = new Date();
  const child: CampaignDoc = {
    _id: childId,
    name: `${series.name} - ${created.toISOString().slice(0, 10)}`.slice(0, 300),
    subject: series.subject,
    previewText: series.previewText,
    fromName: series.fromName,
    fromEmail: series.fromEmail,
    replyTo: series.replyTo,
    html: applyRssItems(series.html, items),
    design: null,
    templateId: series.templateId,
    // Same format as the series; the text version is generated from the html (which holds the posts).
    format: series.format ?? "html",
    textBody: null,
    listIds: series.listIds ?? [],
    segmentIds: series.segmentIds ?? [],
    abTest: null,
    type: "regular",
    parentId: seriesId,
    runKind: "rss",
    status: "draft",
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    totalRecipients: 0,
    createdAt: created,
    updatedAt: created,
  };
  await insertIgnoringDuplicates(campaigns, [child]);

  const current = await campaigns.findOne({ _id: childId }, { projection: { status: 1, totalRecipients: 1 } });
  let queued = current?.totalRecipients ?? 0;
  if (current?.status === "draft") {
    try {
      queued = (await queueCampaign(childId)).queued;
    } catch (err) {
      if (err instanceof CampaignError && err.code === "busy") {
        // Someone (a crashed run?) is queueing it right now: leave the claim to go stale and retry.
        return log("error", items.length, 0, err.message);
      }
      // Can't be sent (e.g. nobody on the lists): drop the run, keep the posts for next time.
      await campaigns.deleteOne({ _id: childId, status: "draft" });
      const message = err instanceof CampaignError ? err.message : `The email couldn't be queued: ${errorMessage(err)}`;
      await release({ "rss.lastError": message, "rss.nextRunAt": next });
      return log("error", items.length, 0, message);
    }
  }

  // 5. Advance the cursor.
  const advanced = advanceCursor(cursor, items);
  await campaigns.updateOne(
    { _id: seriesId, "rss.runningAt": now },
    {
      $set: {
        "rss.runningAt": null,
        "rss.seenIds": advanced.seenIds,
        "rss.lastItemAt": advanced.lastItemAt,
        "rss.lastRunAt": new Date(),
        "rss.lastCheckedAt": new Date(),
        "rss.lastError": null,
        "rss.nextRunAt": next,
        updatedAt: new Date(),
      },
      $inc: { "rss.runCount": 1 },
    },
  );
  return log("sent", items.length, queued);
}

/** Draft series -> active ("sending"). First run at `firstRunAt`, else the next scheduled time. */
export async function startRssSeries(seriesId: string, firstRunAt?: Date | null): Promise<Date> {
  const { campaigns } = await collections();
  const series = await campaigns.findOne({ _id: seriesId });
  if (!series || series.type !== "rss" || !series.rss) throw new CampaignError("This isn't an RSS series.");
  if (series.status !== "draft" && series.status !== "scheduled") {
    throw new CampaignError("This series has already been started.");
  }
  const problems: string[] = [];
  if (!series.subject?.trim()) problems.push("Add a subject line");
  if (!series.fromEmail?.trim()) problems.push("Add your sender email in Settings");
  if (!series.html?.trim()) problems.push("The email content is empty");
  if ((series.listIds ?? []).length === 0) problems.push("Choose at least one list to send to");
  if (problems.length) throw new CampaignError(`${problems.join("; ")}.`, "problems");
  // Check the feed works now, so a typo shows up straight away.
  try {
    await fetchFeed(series.rss.feedUrl);
  } catch (err) {
    throw new CampaignError(err instanceof FeedError ? err.message : "The feed couldn't be read.", "problems");
  }
  const now = new Date();
  const first = firstRunAt && firstRunAt > now ? firstRunAt : nextRunAfter(now, series.rss);
  const res = await campaigns.updateOne(
    {
      _id: seriesId,
      status: { $in: ["draft", "scheduled"] },
      queueLockedAt: null,
    },
    {
      $set: {
        status: "sending",
        startedAt: now,
        scheduledAt: null,
        completedAt: null,
        "rss.nextRunAt": first,
        "rss.runningAt": null,
        "rss.lastError": null,
        updatedAt: now,
      },
    },
  );
  if (res.matchedCount === 0) throw new CampaignError("This series has just been started by someone else.", "busy");
  return first;
}

/** "Check now": run an active series at the next worker tick. */
export async function runRssSeriesNow(seriesId: string): Promise<void> {
  const { campaigns } = await collections();
  const now = new Date();
  const res = await campaigns.updateOne(
    { _id: seriesId, type: "rss", status: "sending" },
    { $set: { "rss.nextRunAt": now, updatedAt: now } },
  );
  if (res.matchedCount === 0) throw new CampaignError("Only an active series can be checked now.");
}
