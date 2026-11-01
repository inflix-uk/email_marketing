// Campaign types: Regular (default), A/B test, Auto resend, RSS series.
// The worker calls processCampaignTypes() once per loop; the web app uses the
// report helpers and the form parser. No next/* imports (runs in the worker).

import { decideDueVariantTests, releasePendingRemainders } from "./ab-runner";
import { processDueResends } from "./resend-runner";
import { processDueRssSeries } from "./rss-runner";
import { errorMessage } from "./store";

export { campaignType } from "./hooks";
export { chooseVariantWinner, getVariantResults } from "./ab-runner";
export { checkFeedUrl, fetchFeed, runRssSeriesNow, startRssSeries } from "./rss-runner";

export interface CampaignTypesResult {
  /** Human-readable lines for the worker log. */
  lines: string[];
  /** Number of actions taken (0 = nothing was due). */
  actions: number;
}

const short = (id: string) => id.slice(0, 8);

/**
 * Everything time-based the campaign types need, in one call:
 * A/B winners at their decision time, auto resends when due, RSS runs.
 * Never throws: one failing part doesn't stop the others (or the sender).
 */
export async function processCampaignTypes(opts: { now?: Date; campaignIds?: string[] } = {}): Promise<CampaignTypesResult> {
  const now = opts.now ?? new Date();
  const ids = opts.campaignIds;
  const result: CampaignTypesResult = { lines: [], actions: 0 };
  if (ids && ids.length === 0) return result;

  const step = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      console.error(`[worker] ${label} error (continuing):`, err);
      result.lines.push(`[worker] ${label} error: ${errorMessage(err)}`);
    }
  };

  await step("A/B test", async () => {
    for (const d of await decideDueVariantTests(now, ids)) {
      result.actions++;
      result.lines.push(
        d.winner
          ? `[worker] campaign "${d.name}" (${short(d.campaignId)}): A/B test decided - version ${d.winner} wins, sending it to the rest`
          : `[worker] campaign "${d.name}" (${short(d.campaignId)}): A/B test is a tie or had no engagement - waiting for a manual choice`,
      );
    }
    const released = await releasePendingRemainders(ids);
    if (released > 0) result.actions++;
  });

  await step("auto resend", async () => {
    for (const r of await processDueResends(now, ids)) {
      result.actions++;
      result.lines.push(
        r.queued > 0
          ? `[worker] campaign "${r.name}" (${short(r.campaignId)}): auto resend queued for ${r.queued} people`
          : `[worker] campaign "${r.name}" (${short(r.campaignId)}): auto resend skipped - ${r.note ?? "nobody to resend to"}`,
      );
    }
  });

  await step("RSS", async () => {
    for (const r of await processDueRssSeries(now, ids)) {
      result.actions++;
      result.lines.push(
        r.outcome === "sent"
          ? `[worker] RSS series "${r.name}" (${short(r.seriesId)}): ${r.posts} new post(s), queued ${r.queued} email(s)`
          : r.outcome === "no-new-posts"
            ? `[worker] RSS series "${r.name}" (${short(r.seriesId)}): no new posts - nothing sent`
            : `[worker] RSS series "${r.name}" (${short(r.seriesId)}): ${r.error}`,
      );
    }
  });

  return result;
}
