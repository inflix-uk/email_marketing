import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeMetrics, formatRate, formatShare, ratio } from "./metrics";

describe("computeMetrics (spec fixture)", () => {
  const m = computeMetrics({
    sent: 1000,
    uniqueOpens: 200,
    totalOpens: 400,
    uniqueClicks: 50,
    totalClicks: 90,
    hardBounces: 30,
    softBounces: 20,
    unsubscribes: 8,
    complaints: 1,
  });

  test("rates", () => {
    assert.equal(formatRate(m.openRate), "20.00%");
    assert.equal(formatRate(m.clickRate), "5.00%");
    assert.equal(formatRate(m.clickToOpenRate), "25.00%");
    assert.equal(formatRate(m.hardBounceRate), "3.00%");
    assert.equal(formatRate(m.softBounceRate), "2.00%");
    assert.equal(formatRate(m.bounceRate), "5.00%");
    assert.equal(formatRate(m.unsubscribeRate), "0.80%");
    assert.equal(formatRate(m.complaintRate), "0.10%");
  });

  test("accepted excluding hard bounces", () => {
    assert.equal(m.acceptedExclHardBounces, 970);
  });

  test("keeps full precision", () => {
    assert.equal(m.openRate, 0.2);
    assert.equal(m.complaintRate, 0.001);
  });
});

describe("zero denominators", () => {
  test("nothing sent: every rate is N/A", () => {
    const m = computeMetrics({
      sent: 0,
      uniqueOpens: 0,
      totalOpens: 0,
      uniqueClicks: 0,
      totalClicks: 0,
      hardBounces: 0,
      softBounces: 0,
      unsubscribes: 0,
      complaints: 0,
    });
    for (const v of [m.openRate, m.clickRate, m.clickToOpenRate, m.bounceRate, m.unsubscribeRate, m.complaintRate]) {
      assert.equal(v, null);
      assert.equal(formatRate(v), "N/A");
    }
    assert.equal(m.acceptedExclHardBounces, 0);
  });

  test("click-to-open is N/A when nobody opened", () => {
    const m = computeMetrics({
      sent: 10,
      uniqueOpens: 0,
      totalOpens: 0,
      uniqueClicks: 0,
      totalClicks: 0,
      hardBounces: 0,
      softBounces: 0,
      unsubscribes: 0,
      complaints: 0,
    });
    assert.equal(m.clickToOpenRate, null);
    assert.equal(formatRate(m.openRate), "0.00%");
  });

  test("acceptedHardBounces overrides hard bounces for the accepted count", () => {
    const m = computeMetrics({
      sent: 100,
      uniqueOpens: 0,
      totalOpens: 0,
      uniqueClicks: 0,
      totalClicks: 0,
      hardBounces: 5,
      acceptedHardBounces: 2,
      softBounces: 0,
      unsubscribes: 0,
      complaints: 0,
    });
    assert.equal(m.acceptedExclHardBounces, 98);
    assert.equal(formatRate(m.hardBounceRate), "5.00%");
  });
});

describe("helpers", () => {
  test("ratio", () => {
    assert.equal(ratio(1, 4), 0.25);
    assert.equal(ratio(1, 0), null);
    assert.equal(ratio(1, Number.NaN), null);
  });
  test("formatShare", () => {
    assert.equal(formatShare(1, 3), "33.33%");
    assert.equal(formatShare(0, 0), "N/A");
  });
});
