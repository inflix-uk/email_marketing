import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateRateLimit, type RateLimitOptions } from "@/lib/rate-limit";
import {
  attemptLogin,
  loginEmailKey,
  loginIpKey,
  MAX_FAILED_PER_EMAIL,
  MAX_FAILED_PER_IP,
  WRONG_CREDENTIALS,
  type LoginDeps,
} from "./throttle";

/** In-memory stand-in for the rateLimits collection, with a clock the test controls. */
function fakeDeps(accounts: Record<string, string>) {
  const counters = new Map<string, { count: number; expiresAt: Date }>();
  const state = { now: new Date("2026-10-13T10:00:00Z"), passwordChecks: 0 };
  const deps: LoginDeps = {
    async rateLimit(key: string, opts: RateLimitOptions) {
      let counter = counters.get(key);
      if (!counter || counter.expiresAt <= state.now) {
        counter = { count: 0, expiresAt: new Date(state.now.getTime() + opts.windowSeconds * 1000) };
        counters.set(key, counter);
      }
      counter.count++;
      return evaluateRateLimit(counter.count, counter.expiresAt, opts.limit, state.now);
    },
    async refundRateLimit(key: string) {
      const counter = counters.get(key);
      if (counter && counter.count > 0) counter.count--;
    },
    async resetRateLimit(key: string) {
      counters.delete(key);
    },
    async checkCredentials(email: string, password: string) {
      state.passwordChecks++;
      return accounts[email.trim().toLowerCase()] === password;
    },
  };
  return { deps, counters, state };
}

const EMAIL = "jane@example.com";
const IP = "203.0.113.7";

describe("login keys", () => {
  test("the email key ignores case and spaces", () => {
    assert.equal(loginEmailKey("  Jane@Example.com "), loginEmailKey(EMAIL));
    assert.equal(loginEmailKey(EMAIL), "login:email:jane@example.com");
  });

  test("no IP counter when the address is unknown", () => {
    assert.equal(loginIpKey("unknown"), null);
    assert.equal(loginIpKey(""), null);
    assert.equal(loginIpKey(IP), "login:ip:203.0.113.7");
  });
});

describe("attemptLogin", () => {
  test("a correct password signs in", async () => {
    const { deps } = fakeDeps({ [EMAIL]: "right-password" });
    assert.deepEqual(await attemptLogin(deps, EMAIL, "right-password", IP), { ok: true });
  });

  test("blocks an email after 5 wrong passwords, without checking the 6th", async () => {
    const { deps, state } = fakeDeps({ [EMAIL]: "right-password" });
    for (let i = 0; i < MAX_FAILED_PER_EMAIL; i++) {
      assert.deepEqual(await attemptLogin(deps, EMAIL, "wrong", IP), { ok: false, error: WRONG_CREDENTIALS });
    }
    assert.equal(state.passwordChecks, 5);

    // Even the right password is refused now, and it is never looked at.
    assert.deepEqual(await attemptLogin(deps, EMAIL, "right-password", IP), {
      ok: false,
      error: "Too many attempts. Try again in 15 minutes.",
    });
    assert.equal(state.passwordChecks, 5);

    // Another account from the same address is not affected.
    assert.deepEqual(await attemptLogin(deps, "sam@example.com", "x", IP), { ok: false, error: WRONG_CREDENTIALS });
  });

  test("the message counts down and the block ends with the window", async () => {
    const { deps, state } = fakeDeps({ [EMAIL]: "right-password" });
    for (let i = 0; i < MAX_FAILED_PER_EMAIL; i++) await attemptLogin(deps, EMAIL, "wrong", IP);

    state.now = new Date(state.now.getTime() + 10 * 60 * 1000 + 30 * 1000);
    assert.deepEqual(await attemptLogin(deps, EMAIL, "wrong", IP), {
      ok: false,
      error: "Too many attempts. Try again in 5 minutes.",
    });

    state.now = new Date(state.now.getTime() + 5 * 60 * 1000);
    assert.deepEqual(await attemptLogin(deps, EMAIL, "right-password", IP), { ok: true });
  });

  test("a successful sign-in doesn't count and forgives earlier typos", async () => {
    const { deps, counters } = fakeDeps({ [EMAIL]: "right-password" });
    for (let i = 0; i < MAX_FAILED_PER_EMAIL - 1; i++) await attemptLogin(deps, EMAIL, "wrong", IP);
    assert.deepEqual(await attemptLogin(deps, EMAIL, "right-password", IP), { ok: true });

    assert.equal(counters.has(loginEmailKey(EMAIL)), false);
    assert.equal(counters.get("login:ip:" + IP)?.count, MAX_FAILED_PER_EMAIL - 1); // only the failures

    // Signing in again and again never trips the limit.
    for (let i = 0; i < 30; i++) assert.deepEqual(await attemptLogin(deps, EMAIL, "right-password", IP), { ok: true });
    for (let i = 0; i < MAX_FAILED_PER_EMAIL; i++) {
      assert.deepEqual(await attemptLogin(deps, EMAIL, "wrong", IP), { ok: false, error: WRONG_CREDENTIALS });
    }
  });

  test("blocks an IP address after 20 failures across different emails", async () => {
    const { deps, state } = fakeDeps({ [EMAIL]: "right-password" });
    for (let i = 0; i < MAX_FAILED_PER_IP; i++) {
      assert.deepEqual(await attemptLogin(deps, `user${i}@example.com`, "guess", IP), { ok: false, error: WRONG_CREDENTIALS });
    }
    const checksBefore = state.passwordChecks;
    assert.deepEqual(await attemptLogin(deps, EMAIL, "right-password", IP), {
      ok: false,
      error: "Too many attempts. Try again in 15 minutes.",
    });
    assert.equal(state.passwordChecks, checksBefore);

    // The same account from another address still works.
    assert.deepEqual(await attemptLogin(deps, EMAIL, "right-password", "198.51.100.9"), { ok: true });
  });

  test("with an unknown address only the per-email limit applies", async () => {
    const { deps, counters } = fakeDeps({ [EMAIL]: "right-password" });
    for (let i = 0; i < MAX_FAILED_PER_IP + 5; i++) await attemptLogin(deps, `user${i}@example.com`, "guess", "unknown");
    assert.equal([...counters.keys()].some((k) => k.startsWith("login:ip:")), false);
    assert.deepEqual(await attemptLogin(deps, EMAIL, "right-password", "unknown"), { ok: true });
  });
});
