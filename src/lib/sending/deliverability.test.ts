import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOUNCE_PAUSE_MIN_SENDS, bounceRatePercent, exceedsBounceLimit, mailboxRejection } from "./bounces";
import { quotaLeft, startOfUtcDay, utcDayKey } from "./quota";
import { emptyStats } from "./stats";
import { isBotUserAgent } from "./tracking";

// Pure parts of the deliverability features: daily quota maths, the
// bounce-rate rule, "is this SMTP error a dead mailbox?" and bot detection.

describe("daily send quota", () => {
  it("is unlimited when the limit is 0 / unset / nonsense", () => {
    assert.equal(quotaLeft(0, 0), Infinity);
    assert.equal(quotaLeft(0, 5000), Infinity);
    assert.equal(quotaLeft(undefined, 10), Infinity);
    assert.equal(quotaLeft(-5, 10), Infinity);
    assert.equal(quotaLeft("abc", 10), Infinity);
  });

  it("is the limit minus today's sends", () => {
    assert.equal(quotaLeft(200, 0), 200);
    assert.equal(quotaLeft(200, 150), 50);
    assert.equal(quotaLeft(200, 200), 0);
    assert.equal(quotaLeft("200", 199), 1);
  });

  it("is never negative (limit lowered during the day)", () => {
    assert.equal(quotaLeft(100, 250), 0);
  });

  it("the day starts at 00:00 UTC", () => {
    assert.equal(startOfUtcDay(new Date("2026-03-05T23:59:59.999Z")).toISOString(), "2026-03-05T00:00:00.000Z");
    assert.equal(startOfUtcDay(new Date("2026-03-06T00:00:00.000Z")).toISOString(), "2026-03-06T00:00:00.000Z");
    // 01:30 on the 6th in UTC+2 is still the 5th in UTC
    assert.equal(utcDayKey(new Date("2026-03-06T01:30:00+02:00")), "2026-03-05");
    assert.notEqual(utcDayKey(new Date("2026-03-05T23:59:59Z")), utcDayKey(new Date("2026-03-06T00:00:01Z")));
  });
});

describe("bounce-rate auto-pause rule", () => {
  const stats = (sent: number, bounced: number, failed = 0) => ({ ...emptyStats(), sent, bounced, failed });

  it("needs at least 50 attempted emails", () => {
    assert.equal(BOUNCE_PAUSE_MIN_SENDS, 50);
    assert.equal(exceedsBounceLimit(stats(49, 49), 8), false);
    assert.equal(exceedsBounceLimit(stats(50, 5), 8), true);
  });

  it("pauses only above the limit", () => {
    assert.equal(exceedsBounceLimit(stats(100, 8), 8), false);
    assert.equal(exceedsBounceLimit(stats(100, 9), 8), true);
    assert.equal(exceedsBounceLimit(stats(1000, 30), 2.5), true);
  });

  it("0 (or nonsense) turns it off", () => {
    assert.equal(exceedsBounceLimit(stats(100, 100), 0), false);
    assert.equal(exceedsBounceLimit(stats(100, 100), undefined), false);
  });

  it("counts mailboxes rejected at send time (failed + bounced) as attempts", () => {
    // 45 delivered + 5 rejected with "user unknown": 5 of 50 attempted
    assert.equal(bounceRatePercent(stats(45, 5, 5)), 10);
    assert.equal(exceedsBounceLimit(stats(45, 5, 5), 8), true);
    assert.equal(bounceRatePercent(stats(0, 0)), 0);
  });
});

describe("mailboxRejection (SMTP errors at send time)", () => {
  const smtp = (responseCode: number, response: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(`Can't send mail - all recipients were rejected: ${response}`), {
      code: "EENVELOPE",
      responseCode,
      response,
      ...extra,
    });

  it("recognises unknown-mailbox rejections", () => {
    for (const [code, response] of [
      [550, "550 5.1.1 <gone@example.com>: Recipient address rejected: User unknown in virtual mailbox table"],
      [550, "550-5.1.1 The email account that you tried to reach does not exist. Please try\n550 5.1.1 double-checking the recipient's email address"],
      [550, "550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup"],
      [550, "550 5.1.0 Address rejected: no such user here"],
      [550, "550 No such user here"],
      [550, "550 Unknown user gone@example.com"],
      [553, "553 5.1.1 Mailbox does not exist"],
    ] as const) {
      assert.ok(mailboxRejection(smtp(code, response)), response);
    }
  });

  it("returns the server response as the bounce reason, on one line", () => {
    assert.equal(
      mailboxRejection(smtp(550, "550-5.1.1 The email account\n550 5.1.1 does not exist")),
      "550-5.1.1 The email account 550 5.1.1 does not exist",
    );
  });

  it("reads the message when nodemailer gives no response field", () => {
    const err = Object.assign(new Error("Can't send mail - all recipients were rejected: 550 5.1.1 User unknown"), {
      responseCode: 550,
    });
    assert.ok(mailboxRejection(err));
    const nested = Object.assign(new Error("Can't send mail - all recipients were rejected"), {
      code: "EENVELOPE",
      rejectedErrors: [{ responseCode: 550, response: "550 5.1.1 User unknown" }],
    });
    assert.ok(mailboxRejection(nested));
  });

  it("never treats auth, config, policy, content or temporary errors as bounces", () => {
    for (const [code, response] of [
      [535, "535 5.7.8 Authentication credentials invalid"],
      [530, "530 5.7.0 Must issue a STARTTLS command first"],
      [554, "554 5.7.1 Relay access denied"],
      [554, "554 Message rejected: Email address is not verified. The following identities failed the check"],
      [550, "550 5.7.1 Message rejected as spam by content filtering"],
      [550, "550 5.7.26 This mail is unauthenticated: DMARC policy"],
      [550, "550 5.1.1 Sender address rejected: User unknown in virtual mailbox table"],
      [550, "550 5.1.8 Sender address rejected: Domain not found"],
      [550, "550 5.1.0 Sender rejected"],
      [550, "550 5.1.0 Address rejected"],
      [550, "550 5.5.0 Requested action not taken: mailbox unavailable"],
      [550, "550 5.4.1 Recipient address rejected: Access denied"],
      [552, "552 5.2.2 Mailbox full: user is over quota"],
      [550, "550 Blocked: your IP is on a blocklist"],
      [550, "550 Requested action not taken"],
      [554, "554 5.1.0 Transaction failed"],
      [450, "450 4.1.1 User unknown, try again later"],
      [421, "421 4.7.0 Too many connections"],
    ] as const) {
      assert.equal(mailboxRejection(smtp(code, response)), null, response);
    }
  });

  it("ignores errors without an SMTP reply (network, timeouts, junk)", () => {
    assert.equal(mailboxRejection(new Error("connect ECONNREFUSED 127.0.0.1:587")), null);
    assert.equal(mailboxRejection(Object.assign(new Error("Greeting never received"), { code: "ETIMEDOUT" })), null);
    assert.equal(mailboxRejection(null), null);
    assert.equal(mailboxRejection("550 5.1.1 User unknown"), null);
  });

  it("does not mistake an IP address or another number for the status code", () => {
    assert.equal(mailboxRejection(smtp(550, "550 5.7.1 Connection from 10.5.1.1 refused")), null);
    assert.equal(mailboxRejection(smtp(554, "554 5.3.0 Rejected, id 550 5.1.1.9")), null);
  });
});

describe("isBotUserAgent", () => {
  it("lets real mail apps, browsers and image proxies through", () => {
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)",
      "YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html",
      "Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17628; Pro)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      "Mozilla/5.0",
      "Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP2A)",
      "Mozilla/5.0 (Linux; Android 13; CUBOT_NOTE_S) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
    ]) {
      assert.equal(isBotUserAgent(ua), false, ua);
    }
  });

  it("counts a missing user agent (some mail apps send none)", () => {
    assert.equal(isBotUserAgent(null), false);
    assert.equal(isBotUserAgent(undefined), false);
    assert.equal(isBotUserAgent(""), false);
  });

  it("filters link scanners, crawlers, previewers and scripts", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Barracuda Sentinel (EE)",
      "Mozilla/5.0 (compatible; Proofpoint URL Defense)",
      "Mimecast-URL-Scanner/1.0",
      "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "WhatsApp/2.23.20.0 A",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
      "curl/8.4.0",
      "Wget/1.21.4",
      "python-requests/2.31.0",
      "Go-http-client/1.1",
      "Java/17.0.2",
      "Apache-HttpClient/4.5.13 (Java/11.0.19)",
      "axios/1.6.2",
      "PostmanRuntime/7.36.0",
      "SafeLinks Scanner",
    ]) {
      assert.equal(isBotUserAgent(ua), true, ua);
    }
  });
});
