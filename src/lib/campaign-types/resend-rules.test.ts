import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampResendHours, describeDelay, isResendEligible, resendDueAt, resendSendFilter } from "./resend-rules";

const at = new Date("2026-01-01T00:00:00Z");
const send = (extra: Record<string, unknown> = {}) => ({
  status: "sent" as const,
  openedAt: null,
  clickedAt: null,
  unsubscribedAt: null,
  bouncedAt: null,
  complainedAt: null,
  ...extra,
});

describe("isResendEligible", () => {
  it("didn't open: only people who neither opened nor clicked", () => {
    assert.equal(isResendEligible(send(), "subscribed", "not_opened"), true);
    assert.equal(isResendEligible(send({ openedAt: at }), "subscribed", "not_opened"), false);
    // A click proves an open even when the pixel was blocked.
    assert.equal(isResendEligible(send({ clickedAt: at }), "subscribed", "not_opened"), false);
  });

  it("didn't click: openers who didn't click still qualify", () => {
    assert.equal(isResendEligible(send({ openedAt: at }), "subscribed", "not_clicked"), true);
    assert.equal(isResendEligible(send({ clickedAt: at, openedAt: at }), "subscribed", "not_clicked"), false);
  });

  it("never people who can't be emailed any more", () => {
    for (const status of ["unsubscribed", "bounced", "complained", "pending"] as const) {
      assert.equal(isResendEligible(send(), status, "not_opened"), false, status);
    }
    assert.equal(isResendEligible(send(), null, "not_opened"), false);
    assert.equal(isResendEligible(send({ unsubscribedAt: at }), "subscribed", "not_opened"), false);
    assert.equal(isResendEligible(send({ bouncedAt: at }), "subscribed", "not_opened"), false);
    assert.equal(isResendEligible(send({ complainedAt: at }), "subscribed", "not_opened"), false);
  });

  it("only people the first email actually went to", () => {
    for (const status of ["queued", "failed", "skipped", "sending"] as const) {
      assert.equal(isResendEligible(send({ status }), "subscribed", "not_opened"), false, status);
    }
  });
});

describe("resendSendFilter", () => {
  it("matches the same rule as a query", () => {
    assert.deepEqual(resendSendFilter("p1", "not_opened"), {
      campaignId: "p1",
      status: "sent",
      unsubscribedAt: null,
      bouncedAt: null,
      complainedAt: null,
      clickedAt: null,
      openedAt: null,
    });
    assert.equal("openedAt" in resendSendFilter("p1", "not_clicked"), false);
  });
});

describe("timing", () => {
  it("clamps the delay and computes the due time", () => {
    assert.equal(clampResendHours(0), 1);
    assert.equal(clampResendHours(100_000), 720);
    assert.equal(clampResendHours("abc"), 72);
    assert.deepEqual(resendDueAt(at, 24), new Date("2026-01-02T00:00:00Z"));
    assert.equal(describeDelay(72), "3 days");
    assert.equal(describeDelay(24), "1 day");
    assert.equal(describeDelay(5), "5 hours");
  });
});
