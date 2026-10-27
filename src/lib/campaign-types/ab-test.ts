// Multivariate A/B tests (campaign.type "ab") - the pure parts, unit-tested.
//
// Allocation: every contact of the frozen audience (the sends created when the
// campaign starts) gets at most one variant, decided by a seeded hash of
// campaignId + contactId. The same contact always lands in the same bucket, and
// the buckets never overlap, so the variants are disjoint by construction.
//
// "sample" mode: samplePercent% of the audience is split evenly over the
// variants and sent straight away; everyone else is queued but held back
// (nextAttemptAt = HELD_UNTIL) until a winner is picked, then released.
// "split" mode: the whole audience is split, there is no remainder.

import type {
  VariantContent,
  VariantDecision,
  VariantKey,
  VariantResult,
  VariantTest,
} from "@/db/schema";
import { VARIANT_KEYS } from "@/db/schema";

export const MAX_VARIANTS = VARIANT_KEYS.length;
export const MIN_SAMPLE_PERCENT = 5;
export const MAX_SAMPLE_PERCENT = 90;

/** nextAttemptAt of a held-back send: never due until the winner releases it. */
export const HELD_UNTIL = new Date("9999-01-01T00:00:00.000Z");

/** 32-bit FNV-1a, then a murmur-style finaliser: a well-spread unit value in [0, 1). */
export function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function clampPercent(value: unknown, fallback = 20): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_SAMPLE_PERCENT, Math.max(MIN_SAMPLE_PERCENT, Math.round(n)));
}

/**
 * The variant one contact gets, or null when it is in the held-back remainder.
 * Pure and deterministic: the same (campaign, contact) always gets the same answer.
 */
export function allocateVariant(
  campaignId: string,
  contactId: string,
  test: Pick<VariantTest, "mode" | "samplePercent"> & { variants: Pick<VariantContent, "key">[] },
): VariantKey | null {
  const keys = test.variants.map((v) => v.key);
  if (keys.length === 0) return null;
  const u = hashUnit(`${campaignId}:${contactId}`);
  const share = test.mode === "split" ? 1 : clampPercent(test.samplePercent) / 100;
  if (u >= share) return null;
  const bucket = Math.min(keys.length - 1, Math.floor((u / share) * keys.length));
  return keys[bucket];
}

/** True when this campaign holds back a remainder for the winner. */
export function hasRemainder(test: Pick<VariantTest, "mode"> | null | undefined): boolean {
  return test?.mode === "sample";
}

/** Fields set on the campaign when sending starts (queueCampaign publish). */
export function variantTestStartFields(test: VariantTest, startedAt: Date): Record<string, unknown> {
  const sample = hasRemainder(test);
  return {
    "variantTest.state": sample ? "testing" : "decided",
    "variantTest.decideAt": sample ? new Date(startedAt.getTime() + Math.max(0, test.waitHours) * 3_600_000) : null,
    "variantTest.winner": null,
    "variantTest.decidedAt": null,
    "variantTest.decision": null,
    "variantTest.remainderReleasedAt": null,
  };
}

export function rate(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

export function metricRate(result: VariantResult, metric: "click" | "open"): number {
  return rate(metric === "click" ? result.clicked : result.opened, result.sent);
}

/**
 * The winner by unique click (or open) rate among variants that were sent to
 * anyone. `null` = hold for a human: nobody engaged, or the best rate is shared.
 */
export function pickVariantWinner(results: VariantResult[], metric: "click" | "open"): VariantKey | null {
  const candidates = results.filter((r) => r.sent > 0);
  if (candidates.length === 0) return null;
  let best = -1;
  let winners: VariantKey[] = [];
  for (const r of candidates) {
    const value = metricRate(r, metric);
    // Compare with a small tolerance so 1/3 vs 2/6 counts as a tie.
    if (value > best + 1e-12) {
      best = value;
      winners = [r.key];
    } else if (Math.abs(value - best) <= 1e-12) {
      winners.push(r.key);
    }
  }
  if (best <= 0 || winners.length !== 1) return null;
  return winners[0];
}

export function buildDecision(
  results: VariantResult[],
  metric: "click" | "open",
  by: "auto" | "manual",
  at: Date,
): VariantDecision {
  return { at, metric, by, results: results.map((r) => ({ ...r })) };
}

/** Every variant key with zeros, then the counted rows merged in (in variant order). */
export function completeResults(
  variants: Pick<VariantContent, "key">[],
  rows: { key: string; sent: number; opened: number; clicked: number }[],
): VariantResult[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return variants.map((v) => {
    const row = byKey.get(v.key);
    return { key: v.key, sent: row?.sent ?? 0, opened: row?.opened ?? 0, clicked: row?.clicked ?? 0 };
  });
}

type BaseContent = { subject: string; previewText?: string | null; html: string; fromName: string };

/**
 * The content a send gets: its variant's overrides on top of the campaign's
 * own content. Sends without a variant (the remainder) get the winner's
 * version; before a winner exists (never sent - they are held) variant A.
 */
export function contentForVariant<T extends BaseContent>(
  campaign: T,
  test: Pick<VariantTest, "variants" | "winner"> | null | undefined,
  variant: string | null | undefined,
): T {
  if (!test || !Array.isArray(test.variants) || test.variants.length === 0) return campaign;
  const key = variant ?? test.winner ?? "A";
  const v = test.variants.find((x) => x.key === key);
  if (!v) return campaign;
  return {
    ...campaign,
    subject: v.subject?.trim() ? v.subject : campaign.subject,
    html: v.html?.trim() ? v.html : campaign.html,
    previewText: v.html?.trim() ? v.previewText : campaign.previewText,
    fromName: v.fromName?.trim() ? v.fromName : campaign.fromName,
  };
}

/** Problems that stop an A/B campaign from being sent (empty = fine). */
export function variantTestProblems(test: VariantTest | null | undefined): string[] {
  if (!test || !Array.isArray(test.variants) || test.variants.length < 2) {
    return ["Add at least two versions for the A/B test"];
  }
  const problems: string[] = [];
  const others = test.variants.slice(1);
  const usesSubject = test.variable === "subject" || test.variable === "subject_content";
  const usesContent = test.variable === "content" || test.variable === "subject_content";
  for (const v of others) {
    if (usesSubject && !v.subject?.trim()) problems.push(`Add the subject for version ${v.key}`);
    if (usesContent && !v.html?.trim()) problems.push(`Pick the template for version ${v.key}`);
    if (test.variable === "sender" && !v.fromName?.trim()) problems.push(`Add the sender name for version ${v.key}`);
  }
  return problems;
}
