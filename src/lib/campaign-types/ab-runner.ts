// A/B test decisions (campaign.type "ab", mode "sample") - database side.
//
// - At decideAt the worker counts each version's unique opens/clicks and, if
//   one version clearly leads, stores the winner with a snapshot of the counts.
//   On a tie or no engagement at all it holds and marks the test "manual"
//   ("Choose winner manually"); a person can also pick a winner earlier.
// - Every write is conditioned on `variantTest.winner: null`, so the decision is
//   made exactly once (worker vs person) and later opens never rewrite it.
// - The held-back rest of the audience (variant null, nextAttemptAt
//   HELD_UNTIL) is then released once; releasing is idempotent and is retried
//   by the worker until `remainderReleasedAt` is set.

import type { Filter } from "mongodb";
import { collections } from "@/db";
import type { CampaignDoc, VariantKey, VariantResult, VariantTest } from "@/db/schema";
import { CampaignError } from "@/lib/sending/errors";
import { buildDecision, completeResults, HELD_UNTIL, pickVariantWinner } from "./ab-test";

const ACTIVE: CampaignDoc["status"][] = ["sending", "paused"];

function scoped(campaignIds?: string[]): Filter<CampaignDoc> {
  return campaignIds ? { _id: { $in: campaignIds } } : {};
}

/** Unique sent / opened / clicked per version (test-group sends only). */
export async function getVariantResults(campaignId: string, test: Pick<VariantTest, "variants">): Promise<VariantResult[]> {
  const { sends } = await collections();
  const keys = test.variants.map((v) => v.key);
  const set = (field: string) => ({ $ne: [{ $ifNull: [field, null] }, null] });
  const rows = await sends
    .aggregate<{ _id: string; sent: number; opened: number; clicked: number }>([
      { $match: { campaignId, variant: { $in: keys } } },
      {
        $group: {
          _id: "$variant",
          sent: { $sum: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] } },
          opened: { $sum: { $cond: [set("$openedAt"), 1, 0] } },
          clicked: { $sum: { $cond: [set("$clickedAt"), 1, 0] } },
        },
      },
    ])
    .toArray();
  return completeResults(test.variants, rows.map((r) => ({ key: r._id, sent: r.sent, opened: r.opened, clicked: r.clicked })));
}

/** Let the held-back rest go to the winner (idempotent). Returns how many were released now. */
export async function releaseRemainder(campaignId: string): Promise<number> {
  const { campaigns, sends } = await collections();
  const now = new Date();
  const res = await sends.updateMany(
    { campaignId, status: "queued", variant: null, nextAttemptAt: { $gte: HELD_UNTIL } },
    { $set: { nextAttemptAt: now, updatedAt: now } },
  );
  await campaigns.updateOne(
    { _id: campaignId, "variantTest.winner": { $ne: null }, "variantTest.remainderReleasedAt": null },
    { $set: { "variantTest.remainderReleasedAt": now, updatedAt: now } },
  );
  return res.modifiedCount;
}

/** Store the winner once. False when a winner had already been stored. */
async function storeWinner(
  campaignId: string,
  test: VariantTest,
  winner: VariantKey,
  results: VariantResult[],
  by: "auto" | "manual",
  allowedStates: VariantTest["state"][],
): Promise<boolean> {
  const { campaigns } = await collections();
  const now = new Date();
  const res = await campaigns.updateOne(
    {
      _id: campaignId,
      type: "ab",
      status: { $in: ACTIVE },
      "variantTest.mode": "sample",
      "variantTest.winner": null,
      "variantTest.state": { $in: allowedStates },
    },
    {
      $set: {
        "variantTest.winner": winner,
        "variantTest.state": "decided",
        "variantTest.decidedAt": now,
        "variantTest.decision": buildDecision(results, test.metric, by, now),
        updatedAt: now,
      },
    },
  );
  return res.modifiedCount > 0;
}

export interface AbDecisionLog {
  campaignId: string;
  name: string;
  winner: VariantKey | null;
  /** True when it was held for a person to choose. */
  manual: boolean;
}

/** The worker's step: evaluate every test whose wait is over. */
export async function decideDueVariantTests(now: Date, campaignIds?: string[]): Promise<AbDecisionLog[]> {
  const { campaigns } = await collections();
  const due = await campaigns
    .find(
      {
        ...scoped(campaignIds),
        type: "ab",
        status: { $in: ACTIVE },
        "variantTest.mode": "sample",
        "variantTest.state": "testing",
        "variantTest.winner": null,
        "variantTest.decideAt": { $lte: now },
      },
      { projection: { _id: 1, name: 1, variantTest: 1 } },
    )
    .limit(20)
    .toArray();

  const out: AbDecisionLog[] = [];
  for (const c of due) {
    const test = c.variantTest;
    if (!test) continue;
    const results = await getVariantResults(c._id, test);
    const winner = pickVariantWinner(results, test.metric);
    if (winner) {
      if (await storeWinner(c._id, test, winner, results, "auto", ["testing"])) {
        await releaseRemainder(c._id);
        out.push({ campaignId: c._id, name: c.name, winner, manual: false });
      }
      continue;
    }
    // Tie or no engagement: hold the rest until someone chooses.
    const res = await campaigns.updateOne(
      { _id: c._id, "variantTest.state": "testing", "variantTest.winner": null },
      { $set: { "variantTest.state": "manual", updatedAt: new Date() } },
    );
    if (res.modifiedCount > 0) out.push({ campaignId: c._id, name: c.name, winner: null, manual: true });
  }
  return out;
}

/** Finish releases interrupted by a crash (winner stored, rest not released yet). */
export async function releasePendingRemainders(campaignIds?: string[]): Promise<number> {
  const { campaigns } = await collections();
  const pending = await campaigns
    .find(
      {
        ...scoped(campaignIds),
        type: "ab",
        status: { $in: ACTIVE },
        "variantTest.mode": "sample",
        "variantTest.winner": { $ne: null },
        "variantTest.remainderReleasedAt": null,
      },
      { projection: { _id: 1 } },
    )
    .limit(20)
    .toArray();
  let released = 0;
  for (const c of pending) released += await releaseRemainder(c._id);
  return released;
}

/** A person picks the winner (allowed before the automatic decision, and when it was held). */
export async function chooseVariantWinner(campaignId: string, key: string): Promise<VariantKey> {
  const { campaigns } = await collections();
  const campaign = await campaigns.findOne({ _id: campaignId }, { projection: { type: 1, status: 1, variantTest: 1 } });
  const test = campaign?.variantTest;
  if (!campaign || campaign.type !== "ab" || !test) throw new CampaignError("This campaign has no A/B test.");
  if (test.mode !== "sample") throw new CampaignError("This test sends every version to part of the list - there is no winner to pick.");
  if (test.winner) throw new CampaignError(`Version ${test.winner} has already been picked.`);
  if (!ACTIVE.includes(campaign.status)) throw new CampaignError("This campaign is no longer sending.");
  const variant = test.variants.find((v) => v.key === key);
  if (!variant) throw new CampaignError("That version doesn't exist.");

  const results = await getVariantResults(campaignId, test);
  const stored = await storeWinner(campaignId, test, variant.key, results, "manual", ["testing", "manual"]);
  if (!stored) {
    const now = await campaigns.findOne({ _id: campaignId }, { projection: { variantTest: 1 } });
    throw new CampaignError(
      now?.variantTest?.winner ? `Version ${now.variantTest.winner} has just been picked.` : "The winner couldn't be saved. Try again.",
    );
  }
  await releaseRemainder(campaignId);
  return variant.key;
}
