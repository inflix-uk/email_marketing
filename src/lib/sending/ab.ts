// A/B subject tests - the pure parts (no database access, unit-tested).
//
// At queue time `testPercent`% of the recipients form the test group, split
// evenly into variants "A" (campaign.subject) and "B" (abTest.subjectB) and
// sent straight away. Everyone else gets variant null and is held back for
// `waitHours`; when the first of those comes due the worker picks the winner
// by unique open rate and the rest receive the winning subject.
// testPercent 100 = a plain 50/50 split with no winner.

import type { AbTest } from "@/db/schema";

export type Variant = "A" | "B";

type AbSettings = Pick<AbTest, "subjectB" | "testPercent" | "waitHours" | "winner">;

/** True when the campaign has a usable A/B test (a second subject line). */
export function hasAbTest(abTest: Partial<AbSettings> | null | undefined): abTest is AbSettings {
  return Boolean(abTest && typeof abTest.subjectB === "string" && abTest.subjectB.trim());
}

function percent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, n));
}

/** How many of `total` recipients are in the test group (both variants together). */
export function abTestSize(total: number, testPercent: number): number {
  if (!(total > 0)) return 0;
  const pct = percent(testPercent);
  if (pct >= 100) return total;
  // At least one recipient per variant, otherwise there is nothing to compare.
  return Math.min(total, Math.max(2, Math.round((total * pct) / 100)));
}

/** Milliseconds the non-test recipients are held back. 0 when everyone is in the test. */
export function abHoldbackMs(abTest: Pick<AbTest, "testPercent" | "waitHours">): number {
  if (percent(abTest.testPercent) >= 100) return 0;
  const hours = Number(abTest.waitHours);
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 3_600_000) : 0;
}

/** Small deterministic PRNG (mulberry32) seeded from a string, so a queue build is repeatable. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a function to call once per recipient, in queue order: "A" / "B"
 * for the test group, null for everyone else.
 *
 * Selection sampling (Knuth's algorithm S): each recipient is taken with
 * probability (still needed) / (still to come), which picks exactly
 * abTestSize(total) recipients spread over the whole audience. Picks
 * alternate A, B, A, B... so the variants differ by at most one.
 */
export function createAbAssigner(opts: {
  /** Expected number of recipients. */
  total: number;
  testPercent: number;
  /** Any stable string (the campaign id). */
  seed: string;
}): () => Variant | null {
  const size = abTestSize(opts.total, opts.testPercent);
  const random = seededRandom(opts.seed);
  let seen = 0;
  let picked = 0;
  return () => {
    const left = opts.total - seen; // recipients still to come, including this one
    const need = size - picked;
    seen++;
    if (need <= 0) return null;
    if (left > need && random() * left >= need) return null;
    return picked++ % 2 === 0 ? "A" : "B";
  };
}

export interface VariantResult {
  sent: number;
  /** Unique opens. */
  opened: number;
}

/** Winner by unique open rate. A tie, or no data at all, goes to "A". */
export function pickWinner(a: VariantResult, b: VariantResult): Variant {
  const rate = (v: VariantResult) => (v.sent > 0 ? v.opened / v.sent : 0);
  return rate(b) > rate(a) ? "B" : "A";
}

/** A non-test send of an A/B campaign whose winner hasn't been picked yet. */
export function needsWinner(abTest: Partial<AbSettings> | null | undefined, variant: Variant | null | undefined): boolean {
  return hasAbTest(abTest) && variant !== "A" && variant !== "B" && abTest.winner !== "A" && abTest.winner !== "B";
}

/** The subject line a send with this variant gets. Non-test sends get the winner's (A until decided). */
export function subjectForVariant(
  subject: string,
  abTest: Partial<AbSettings> | null | undefined,
  variant: Variant | null | undefined,
): string {
  if (!hasAbTest(abTest)) return subject;
  const which = variant === "A" || variant === "B" ? variant : abTest.winner;
  return which === "B" ? abTest.subjectB : subject;
}
