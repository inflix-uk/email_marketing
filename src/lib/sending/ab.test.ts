import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  abHoldbackMs,
  abTestSize,
  createAbAssigner,
  hasAbTest,
  needsWinner,
  pickWinner,
  seededRandom,
  subjectForVariant,
  type Variant,
} from "./ab";

const test = (overrides: Partial<{ subjectB: string; testPercent: number; waitHours: number; winner: Variant | null }> = {}) => ({
  subjectB: "Subject B",
  testPercent: 20,
  waitHours: 4,
  winner: null,
  decidedAt: null,
  ...overrides,
});

function assignAll(total: number, testPercent: number, seed = "campaign-1", extra = 0) {
  const assign = createAbAssigner({ total, testPercent, seed });
  const out = Array.from({ length: total + extra }, () => assign());
  return {
    out,
    a: out.filter((v) => v === "A").length,
    b: out.filter((v) => v === "B").length,
    rest: out.filter((v) => v === null).length,
  };
}

describe("abTestSize", () => {
  it("is testPercent% of the audience, rounded", () => {
    assert.equal(abTestSize(1000, 20), 200);
    assert.equal(abTestSize(1000, 10), 100);
    assert.equal(abTestSize(15, 50), 8);
  });

  it("is everyone at 100% and never more than the audience", () => {
    assert.equal(abTestSize(37, 100), 37);
    assert.equal(abTestSize(37, 250), 37);
    assert.equal(abTestSize(1, 20), 1);
  });

  it("has at least one recipient per variant", () => {
    assert.equal(abTestSize(5, 10), 2);
    assert.equal(abTestSize(0, 50), 0);
  });
});

describe("createAbAssigner", () => {
  it("puts exactly testPercent% in the test, split evenly", () => {
    const r = assignAll(1000, 20);
    assert.equal(r.a, 100);
    assert.equal(r.b, 100);
    assert.equal(r.rest, 800);
  });

  it("differs by at most one when the test group is odd", () => {
    const r = assignAll(30, 50); // 15 in the test
    assert.equal(r.a + r.b, 15);
    assert.ok(Math.abs(r.a - r.b) <= 1);
  });

  it("at 100% is a plain split with nobody held back", () => {
    const r = assignAll(101, 100);
    assert.equal(r.rest, 0);
    assert.equal(r.a, 51);
    assert.equal(r.b, 50);
  });

  it("spreads the test group over the whole audience instead of taking the first N", () => {
    const { out } = assignAll(1000, 20);
    const firstHalf = out.slice(0, 500).filter(Boolean).length;
    assert.ok(firstHalf > 60 && firstHalf < 140, `test recipients in the first half: ${firstHalf}`);
  });

  it("is stable: the same campaign id gives the same assignment", () => {
    assert.deepEqual(assignAll(200, 30, "abc").out, assignAll(200, 30, "abc").out);
    assert.notDeepEqual(assignAll(200, 30, "abc").out, assignAll(200, 30, "xyz").out);
  });

  it("copes with more recipients than counted (contacts added meanwhile)", () => {
    const r = assignAll(10, 50, "late", 5);
    assert.equal(r.a + r.b, 5);
    assert.equal(r.rest, 10);
    assert.deepEqual(r.out.slice(10), [null, null, null, null, null]);
  });

  it("still fills the test group when fewer recipients arrive than counted", () => {
    const assign = createAbAssigner({ total: 100, testPercent: 50, seed: "short" });
    const out = Array.from({ length: 60 }, () => assign());
    assert.ok(out.filter(Boolean).length >= 10);
  });

  it("tiny audiences: both variants get someone", () => {
    const r = assignAll(3, 10);
    assert.equal(r.a, 1);
    assert.equal(r.b, 1);
    assert.equal(r.rest, 1);
  });
});

describe("seededRandom", () => {
  it("returns numbers in [0, 1)", () => {
    const random = seededRandom("seed");
    for (let i = 0; i < 1000; i++) {
      const n = random();
      assert.ok(n >= 0 && n < 1);
    }
  });
});

describe("pickWinner", () => {
  it("picks the higher unique open rate", () => {
    assert.equal(pickWinner({ sent: 100, opened: 20 }, { sent: 100, opened: 30 }), "B");
    assert.equal(pickWinner({ sent: 100, opened: 31 }, { sent: 100, opened: 30 }), "A");
  });

  it("compares rates, not counts", () => {
    assert.equal(pickWinner({ sent: 100, opened: 30 }, { sent: 50, opened: 20 }), "B");
  });

  it("a tie or no data goes to A", () => {
    assert.equal(pickWinner({ sent: 100, opened: 25 }, { sent: 100, opened: 25 }), "A");
    assert.equal(pickWinner({ sent: 0, opened: 0 }, { sent: 0, opened: 0 }), "A");
    assert.equal(pickWinner({ sent: 10, opened: 0 }, { sent: 10, opened: 0 }), "A");
  });
});

describe("subjectForVariant / needsWinner", () => {
  it("uses the campaign subject without a test", () => {
    assert.equal(subjectForVariant("Subject A", null, null), "Subject A");
    assert.equal(subjectForVariant("Subject A", undefined, "B"), "Subject A");
    assert.equal(subjectForVariant("Subject A", test({ subjectB: "  " }), "B"), "Subject A");
    assert.equal(hasAbTest(test({ subjectB: "" })), false);
  });

  it("gives each test variant its own subject", () => {
    assert.equal(subjectForVariant("Subject A", test(), "A"), "Subject A");
    assert.equal(subjectForVariant("Subject A", test(), "B"), "Subject B");
    // ...whatever the winner turns out to be
    assert.equal(subjectForVariant("Subject A", test({ winner: "B" }), "A"), "Subject A");
  });

  it("gives everyone else the winning subject", () => {
    assert.equal(subjectForVariant("Subject A", test({ winner: "B" }), null), "Subject B");
    assert.equal(subjectForVariant("Subject A", test({ winner: "A" }), undefined), "Subject A");
    assert.equal(subjectForVariant("Subject A", test({ winner: null }), null), "Subject A");
  });

  it("needs a winner only for non-test sends of an undecided test", () => {
    assert.equal(needsWinner(test(), null), true);
    assert.equal(needsWinner(test(), undefined), true);
    assert.equal(needsWinner(test(), "A"), false);
    assert.equal(needsWinner(test({ winner: "B" }), null), false);
    assert.equal(needsWinner(null, null), false);
  });
});

describe("abHoldbackMs", () => {
  it("is waitHours for a partial test and 0 for a full split", () => {
    assert.equal(abHoldbackMs({ testPercent: 20, waitHours: 4 }), 4 * 3_600_000);
    assert.equal(abHoldbackMs({ testPercent: 100, waitHours: 4 }), 0);
    assert.equal(abHoldbackMs({ testPercent: 20, waitHours: 0 }), 0);
  });
});
