import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONFIRM_LINK_MAX_AGE_MS, decideConfirmation, decideSignup } from "./decision";

describe("decideSignup", () => {
  test("unknown address: pending with double opt-in, subscribed without", () => {
    assert.deepEqual(decideSignup(null, true), { action: "create", status: "pending" });
    assert.deepEqual(decideSignup(null, false), { action: "create", status: "subscribed" });
  });

  test("already subscribed: only lists and tags are added", () => {
    assert.deepEqual(decideSignup({ status: "subscribed" }, true), { action: "add_lists" });
    assert.deepEqual(decideSignup({ status: "subscribed" }, false), { action: "add_lists" });
  });

  test("pending: the confirmation is sent again; a single opt-in form subscribes", () => {
    assert.deepEqual(decideSignup({ status: "pending" }, true), { action: "send_confirmation" });
    assert.deepEqual(decideSignup({ status: "pending" }, false), { action: "subscribe" });
  });

  test("unsubscribed: comes back only through a new confirmation", () => {
    assert.deepEqual(decideSignup({ status: "unsubscribed" }, true), { action: "send_confirmation" });
    assert.deepEqual(decideSignup({ status: "unsubscribed" }, false), { action: "ignore" });
  });

  test("bounced and complained contacts are never changed", () => {
    for (const status of ["bounced", "complained"] as const) {
      assert.deepEqual(decideSignup({ status }, true), { action: "ignore" });
      assert.deepEqual(decideSignup({ status }, false), { action: "ignore" });
    }
  });
});

describe("suppression list", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  test("a suppressed address is never re-subscribed by a sign-up", () => {
    for (const status of ["unsubscribed", "pending", "subscribed", "bounced", "complained"] as const) {
      assert.deepEqual(decideSignup({ status, source: "suppression" }, true), { action: "ignore" });
      assert.deepEqual(decideSignup({ status, source: "suppression" }, false), { action: "ignore" });
    }
  });

  test("other sources follow the normal rules", () => {
    assert.deepEqual(decideSignup({ status: "unsubscribed", source: "manual" }, true), { action: "send_confirmation" });
    assert.deepEqual(decideSignup({ status: "unsubscribed", source: null }, true), { action: "send_confirmation" });
  });

  test("a suppressed address is never re-subscribed by a confirmation click", () => {
    const issuedAt = new Date(now.getTime() - 60_000);
    for (const status of ["unsubscribed", "pending"] as const) {
      assert.equal(
        decideConfirmation({ status, source: "suppression", unsubscribedAt: new Date(now.getTime() - 3600_000), issuedAt, now }),
        "refused",
      );
    }
  });
});

describe("decideConfirmation", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  test("pending -> subscribe", () => {
    assert.equal(decideConfirmation({ status: "pending", unsubscribedAt: null, issuedAt: minutesAgo(5), now }), "subscribe");
  });

  test("second click on an already subscribed contact is harmless", () => {
    assert.equal(decideConfirmation({ status: "subscribed", unsubscribedAt: null, issuedAt: minutesAgo(5), now }), "already");
    // ...even with a very old link
    const old = new Date(now.getTime() - 2 * CONFIRM_LINK_MAX_AGE_MS);
    assert.equal(decideConfirmation({ status: "subscribed", unsubscribedAt: null, issuedAt: old, now }), "already");
  });

  test("unsubscribed -> subscribe when the link was requested after the unsubscribe", () => {
    assert.equal(
      decideConfirmation({ status: "unsubscribed", unsubscribedAt: minutesAgo(60), issuedAt: minutesAgo(5), now }),
      "subscribe",
    );
    assert.equal(decideConfirmation({ status: "unsubscribed", unsubscribedAt: null, issuedAt: minutesAgo(5), now }), "subscribe");
  });

  test("an old link can't undo a later unsubscribe", () => {
    assert.equal(
      decideConfirmation({ status: "unsubscribed", unsubscribedAt: minutesAgo(5), issuedAt: minutesAgo(60), now }),
      "expired",
    );
    assert.equal(
      decideConfirmation({ status: "unsubscribed", unsubscribedAt: minutesAgo(5), issuedAt: minutesAgo(5), now }),
      "expired",
    );
  });

  test("links expire", () => {
    const old = new Date(now.getTime() - CONFIRM_LINK_MAX_AGE_MS - 1000);
    assert.equal(decideConfirmation({ status: "pending", unsubscribedAt: null, issuedAt: old, now }), "expired");
    const future = new Date(now.getTime() + 60 * 60_000);
    assert.equal(decideConfirmation({ status: "pending", unsubscribedAt: null, issuedAt: future, now }), "expired");
  });

  test("bounced and complained contacts are never re-subscribed", () => {
    for (const status of ["bounced", "complained"] as const) {
      assert.equal(decideConfirmation({ status, unsubscribedAt: null, issuedAt: minutesAgo(1), now }), "refused");
    }
  });
});
