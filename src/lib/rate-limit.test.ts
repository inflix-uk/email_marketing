import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clientIp, evaluateRateLimit, tooManyAttemptsMessage } from "./rate-limit";

const now = new Date("2026-10-13T10:00:00Z");
const inSeconds = (s: number) => new Date(now.getTime() + s * 1000);

describe("evaluateRateLimit", () => {
  test("allows up to and including the limit", () => {
    assert.deepEqual(evaluateRateLimit(1, inSeconds(60), 5, now), { ok: true, retryAfterSeconds: 0 });
    assert.deepEqual(evaluateRateLimit(5, inSeconds(60), 5, now), { ok: true, retryAfterSeconds: 0 });
  });

  test("blocks above the limit until the window ends", () => {
    assert.deepEqual(evaluateRateLimit(6, inSeconds(60), 5, now), { ok: false, retryAfterSeconds: 60 });
    assert.deepEqual(evaluateRateLimit(99, inSeconds(0.2), 5, now), { ok: false, retryAfterSeconds: 1 });
    assert.deepEqual(evaluateRateLimit(6, inSeconds(899.1), 5, now), { ok: false, retryAfterSeconds: 900 });
  });
});

describe("clientIp", () => {
  const ip = (init: Record<string, string>) => clientIp(new Headers(init));

  test("takes the first x-forwarded-for address", () => {
    assert.equal(ip({ "x-forwarded-for": "203.0.113.7" }), "203.0.113.7");
    assert.equal(ip({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1, 10.0.0.2" }), "203.0.113.7");
  });

  test("falls back to x-real-ip, then to unknown", () => {
    assert.equal(ip({ "x-real-ip": "198.51.100.9" }), "198.51.100.9");
    assert.equal(ip({ "x-forwarded-for": "", "x-real-ip": "198.51.100.9" }), "198.51.100.9");
    assert.equal(ip({}), "unknown");
  });

  test("normalises ports, brackets, case and IPv4-mapped addresses", () => {
    assert.equal(ip({ "x-forwarded-for": "203.0.113.7:51234" }), "203.0.113.7");
    assert.equal(ip({ "x-forwarded-for": "[2001:DB8::1]:443" }), "2001:db8::1");
    assert.equal(ip({ "x-forwarded-for": "2001:DB8::1" }), "2001:db8::1");
    assert.equal(ip({ "x-forwarded-for": "::ffff:203.0.113.7" }), "203.0.113.7");
    assert.equal(ip({ "x-forwarded-for": "::1" }), "::1");
  });

  test("ignores values that are not addresses", () => {
    assert.equal(ip({ "x-forwarded-for": "not an ip" }), "unknown");
    assert.equal(ip({ "x-forwarded-for": "login:email:jane@example.com" }), "unknown");
    assert.equal(ip({ "x-forwarded-for": "x".repeat(500), "x-real-ip": "198.51.100.9" }), "198.51.100.9");
  });
});

describe("tooManyAttemptsMessage", () => {
  test("rounds up to whole minutes", () => {
    assert.equal(tooManyAttemptsMessage(900), "Too many attempts. Try again in 15 minutes.");
    assert.equal(tooManyAttemptsMessage(61), "Too many attempts. Try again in 2 minutes.");
    assert.equal(tooManyAttemptsMessage(60), "Too many attempts. Try again in 1 minute.");
    assert.equal(tooManyAttemptsMessage(1), "Too many attempts. Try again in 1 minute.");
    assert.equal(tooManyAttemptsMessage(0), "Too many attempts. Try again in 1 minute.");
  });
});
