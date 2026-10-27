import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VARIANT_KEYS, type VariantContent, type VariantKey, type VariantTest } from "@/db/schema";
import {
  allocateVariant,
  completeResults,
  contentForVariant,
  hashUnit,
  HELD_UNTIL,
  pickVariantWinner,
  variantTestProblems,
  variantTestStartFields,
} from "./ab-test";
import { campaignTypeProblems, campaignTypeStartFields, createTypeAllocator } from "./hooks";

const variant = (key: VariantKey, extra: Partial<VariantContent> = {}): VariantContent => ({
  key,
  subject: null,
  source: null,
  templateId: null,
  html: null,
  previewText: null,
  design: null,
  fromName: null,
  ...extra,
});

function makeTest(n: number, overrides: Partial<VariantTest> = {}): VariantTest {
  return {
    variable: "subject",
    variants: VARIANT_KEYS.slice(0, n).map((k) => variant(k, k === "A" ? {} : { subject: `Subject ${k}` })),
    mode: "sample",
    samplePercent: 20,
    metric: "click",
    waitHours: 4,
    state: "testing",
    decideAt: null,
    winner: null,
    decidedAt: null,
    decision: null,
    remainderReleasedAt: null,
    ...overrides,
  };
}

const contactIds = Array.from({ length: 20_000 }, (_, i) => `contact-${i}`);

describe("hashUnit", () => {
  it("is deterministic and in [0, 1)", () => {
    for (const seed of ["", "a", "campaign:contact", "x".repeat(500)]) {
      const u = hashUnit(seed);
      assert.equal(u, hashUnit(seed));
      assert.ok(u >= 0 && u < 1);
    }
    assert.notEqual(hashUnit("c1:k1"), hashUnit("c1:k2"));
  });
});

describe("allocateVariant", () => {
  it("is deterministic per (campaign, contact)", () => {
    const test = makeTest(3);
    for (const id of contactIds.slice(0, 500)) {
      assert.equal(allocateVariant("camp-1", id, test), allocateVariant("camp-1", id, test));
    }
  });

  it("gives each person at most one variant, sized close to the sample", () => {
    const test = makeTest(4, { samplePercent: 20 });
    const counts = new Map<string, number>();
    for (const id of contactIds) {
      const v = allocateVariant("camp-2", id, test) ?? "rest";
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const total = contactIds.length;
    // Disjoint by construction: the buckets add up to everyone exactly once.
    assert.equal([...counts.values()].reduce((a, b) => a + b, 0), total);
    const inTest = total - (counts.get("rest") ?? 0);
    assert.ok(Math.abs(inTest / total - 0.2) < 0.02, `sample ${inTest}`);
    for (const k of ["A", "B", "C", "D"]) {
      const share = (counts.get(k) ?? 0) / total;
      assert.ok(Math.abs(share - 0.05) < 0.01, `${k}: ${share}`);
    }
  });

  it("split mode puts everyone in a variant", () => {
    const test = makeTest(3, { mode: "split" });
    const seen = new Set<string>();
    for (const id of contactIds.slice(0, 3000)) {
      const v = allocateVariant("camp-3", id, test);
      assert.ok(v !== null);
      seen.add(v);
    }
    assert.deepEqual([...seen].sort(), ["A", "B", "C"]);
  });

  it("depends on the campaign (a new campaign reshuffles)", () => {
    const test = makeTest(2, { mode: "split" });
    const differ = contactIds.slice(0, 1000).filter((id) => allocateVariant("x", id, test) !== allocateVariant("y", id, test));
    assert.ok(differ.length > 300);
  });

  it("the type allocator holds the remainder back", () => {
    const allocate = createTypeAllocator("camp-4", { type: "ab", variantTest: makeTest(2) })!;
    const results = contactIds.slice(0, 2000).map(allocate);
    assert.ok(results.some((r) => r.variant === null && r.nextAttemptAt === HELD_UNTIL));
    assert.ok(results.every((r) => (r.variant === null) === (r.nextAttemptAt !== undefined)));
    assert.equal(createTypeAllocator("camp-4", { type: "regular" }), null);
  });
});

describe("pickVariantWinner", () => {
  const r = (key: VariantKey, sent: number, opened: number, clicked: number) => ({ key, sent, opened, clicked });

  it("picks the best unique click rate", () => {
    assert.equal(pickVariantWinner([r("A", 100, 50, 5), r("B", 100, 30, 9), r("C", 100, 60, 7)], "click"), "B");
  });

  it("picks the best open rate", () => {
    assert.equal(pickVariantWinner([r("A", 100, 50, 5), r("B", 100, 30, 9), r("C", 100, 60, 7)], "open"), "C");
  });

  it("compares rates, not counts", () => {
    assert.equal(pickVariantWinner([r("A", 200, 0, 10), r("B", 50, 0, 5)], "click"), "B");
  });

  it("holds on a tie", () => {
    assert.equal(pickVariantWinner([r("A", 100, 0, 10), r("B", 100, 0, 10), r("C", 100, 0, 2)], "click"), null);
    assert.equal(pickVariantWinner([r("A", 3, 1, 0), r("B", 6, 2, 0)], "open"), null);
  });

  it("holds with no engagement or no sends", () => {
    assert.equal(pickVariantWinner([r("A", 100, 0, 0), r("B", 100, 0, 0)], "click"), null);
    assert.equal(pickVariantWinner([r("A", 0, 0, 0), r("B", 0, 0, 0)], "click"), null);
  });

  it("ignores versions nobody received", () => {
    assert.equal(pickVariantWinner([r("A", 0, 0, 0), r("B", 10, 0, 1)], "click"), "B");
  });
});

describe("completeResults", () => {
  it("fills missing versions with zeros, in version order", () => {
    const out = completeResults([variant("A"), variant("B"), variant("C")], [{ key: "C", sent: 3, opened: 2, clicked: 1 }]);
    assert.deepEqual(out, [
      { key: "A", sent: 0, opened: 0, clicked: 0 },
      { key: "B", sent: 0, opened: 0, clicked: 0 },
      { key: "C", sent: 3, opened: 2, clicked: 1 },
    ]);
  });
});

describe("contentForVariant", () => {
  const base = { subject: "Main", previewText: "pre", html: "<p>main</p>", fromName: "Zextons" };
  const test = makeTest(3, {
    variants: [
      variant("A"),
      variant("B", { subject: "Other subject", html: "<p>b</p>", previewText: "pre b" }),
      variant("C", { fromName: "Team Inflix" }),
    ],
  });

  it("A is the campaign itself", () => {
    assert.deepEqual(contentForVariant(base, test, "A"), base);
  });

  it("applies a version's overrides", () => {
    assert.deepEqual(contentForVariant(base, test, "B"), { ...base, subject: "Other subject", html: "<p>b</p>", previewText: "pre b" });
    assert.deepEqual(contentForVariant(base, test, "C"), { ...base, fromName: "Team Inflix" });
  });

  it("the remainder gets the winner", () => {
    assert.equal(contentForVariant(base, { ...test, winner: "B" }, null).subject, "Other subject");
    assert.equal(contentForVariant(base, { ...test, winner: null }, null).subject, "Main");
  });

  it("no test = unchanged", () => {
    assert.equal(contentForVariant(base, null, "B"), base);
  });
});

describe("problems and start fields", () => {
  it("flags missing versions", () => {
    assert.deepEqual(variantTestProblems(makeTest(3)), []);
    assert.equal(variantTestProblems(null).length, 1);
    const missing = makeTest(2, { variants: [variant("A"), variant("B")] });
    assert.deepEqual(variantTestProblems(missing), ["Add the subject for version B"]);
    assert.deepEqual(variantTestProblems({ ...missing, variable: "content" }), ["Pick the template for version B"]);
    assert.deepEqual(campaignTypeProblems({ type: "rss" }).length, 1);
    assert.deepEqual(campaignTypeProblems({}), []);
  });

  it("sets the decision time when sending starts", () => {
    const start = new Date("2026-05-01T10:00:00Z");
    const fields = variantTestStartFields(makeTest(2, { waitHours: 4 }), start);
    assert.deepEqual(fields["variantTest.decideAt"], new Date("2026-05-01T14:00:00Z"));
    assert.equal(fields["variantTest.state"], "testing");
    assert.equal(variantTestStartFields(makeTest(2, { mode: "split" }), start)["variantTest.state"], "decided");
    const resend = campaignTypeStartFields(
      {
        type: "resend",
        resend: { delayHours: 48 } as never,
      },
      start,
    );
    assert.deepEqual(resend["resend.dueAt"], new Date("2026-05-03T10:00:00Z"));
  });
});
