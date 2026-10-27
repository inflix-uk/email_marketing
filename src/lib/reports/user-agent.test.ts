import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { classifyHit, classifyUserAgent, countryFromHeaders, isPrivacyProxyUserAgent } from "./user-agent";

const headers = (h: Record<string, string>) => new Headers(h);

describe("classifyUserAgent", () => {
  test("unknown when missing", () => {
    assert.deepEqual(classifyUserAgent(null), { device: "Unknown", client: "Unknown" });
    assert.deepEqual(classifyUserAgent(""), { device: "Unknown", client: "Unknown" });
  });

  test("Gmail and Yahoo image proxies are webmail", () => {
    assert.deepEqual(
      classifyUserAgent("Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)"),
      { device: "Webmail", client: "Gmail" },
    );
    assert.deepEqual(classifyUserAgent("YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html"), {
      device: "Webmail",
      client: "Yahoo Mail",
    });
  });

  test("Apple Mail on iPhone and Mac", () => {
    assert.deepEqual(
      classifyUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"),
      { device: "Mobile", client: "Apple Mail" },
    );
    assert.deepEqual(
      classifyUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"),
      { device: "Desktop", client: "Apple Mail" },
    );
  });

  test("Outlook desktop", () => {
    const ua = "Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17126; Pro)";
    assert.deepEqual(classifyUserAgent(ua), { device: "Desktop", client: "Outlook" });
  });

  test("browsers", () => {
    assert.deepEqual(
      classifyUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
      ),
      { device: "Mobile", client: "Chrome" },
    );
    assert.deepEqual(
      classifyUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
      ),
      { device: "Desktop", client: "Safari" },
    );
  });

  test("Apple privacy proxy", () => {
    assert.equal(isPrivacyProxyUserAgent("Mozilla/5.0"), true);
    assert.equal(classifyUserAgent("Mozilla/5.0").device, "Unknown");
  });
});

describe("classifyHit", () => {
  const sentAt = new Date("2026-10-01T09:00:00Z");
  test("within 2 seconds of sending is a suspected bot", () => {
    const r = classifyHit({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", knownBot: false, sentAt, now: new Date(sentAt.getTime() + 1500) });
    assert.deepEqual(r, { suspectedBot: true, privacyProxy: false });
  });
  test("later hits by a person are not", () => {
    const r = classifyHit({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", knownBot: false, sentAt, now: new Date(sentAt.getTime() + 60_000) });
    assert.deepEqual(r, { suspectedBot: false, privacyProxy: false });
  });
  test("known scanners and the Apple proxy", () => {
    assert.equal(classifyHit({ userAgent: "x", knownBot: true, sentAt: null, now: new Date() }).suspectedBot, true);
    assert.equal(classifyHit({ userAgent: "Mozilla/5.0", knownBot: false, sentAt: null, now: new Date() }).privacyProxy, true);
  });
});

describe("countryFromHeaders", () => {
  test("reads proxy headers", () => {
    assert.equal(countryFromHeaders(headers({ "cf-ipcountry": "gb" })), "GB");
    assert.equal(countryFromHeaders(headers({ "x-vercel-ip-country": "FR" })), "FR");
  });
  test("never guesses", () => {
    assert.equal(countryFromHeaders(headers({})), null);
    assert.equal(countryFromHeaders(headers({ "cf-ipcountry": "XX" })), null);
    assert.equal(countryFromHeaders(headers({ "cf-ipcountry": "T1" })), null);
    assert.equal(countryFromHeaders(headers({ "cf-ipcountry": "United Kingdom" })), null);
  });
});
