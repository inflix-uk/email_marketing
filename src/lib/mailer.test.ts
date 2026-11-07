import assert from "node:assert/strict";
import { describe, test } from "node:test";
import nodemailer from "nodemailer";
import { makeMessageId, smtpClientName, toMailOptions, type OutgoingEmail } from "./mailer";

const base: OutgoingEmail = {
  to: "reader@example.org",
  from: { name: "Acme News", address: "news@acme-mail.co.uk" },
  replyTo: "hello@acme-mail.co.uk",
  subject: "Hello there",
  html: '<!DOCTYPE html><html><body><p>Hi <a href="https://acme-mail.co.uk/">Acme</a></p></body></html>',
  headers: {
    "List-Unsubscribe": "<https://marketing.acme-mail.co.uk/api/unsubscribe/abc?s=x>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
};

/** Build the raw RFC 5322 message exactly as it would go over SMTP, without any network. */
async function raw(msg: OutgoingEmail, text: string): Promise<string> {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "\r\n" });
  const info = await transport.sendMail(toMailOptions(msg, text, new Date("2026-03-02T10:00:00Z")));
  return (info.message as Buffer).toString("utf8");
}

function headerBlock(message: string): string {
  // Unfold long headers (folding onto a continuation line is valid RFC 5322).
  return message.slice(0, message.indexOf("\r\n\r\n")).replace(/\r\n[ \t]+/g, " ");
}

describe("smtpClientName (EHLO hostname)", () => {
  test("uses the public app URL host", () => {
    assert.equal(smtpClientName("https://marketing.acme-mail.co.uk"), "marketing.acme-mail.co.uk");
    assert.equal(smtpClientName("https://Marketing.Acme-Mail.co.uk:8443/path"), "marketing.acme-mail.co.uk");
  });

  test("ignores localhost, IPs, single labels and junk", () => {
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://app:3000",
      "http://my.local",
      "http://box.localhost",
      "",
      null,
      "not a url",
    ]) {
      assert.equal(smtpClientName(url), undefined, String(url));
    }
  });
});

describe("makeMessageId", () => {
  test("uses the sender's domain", () => {
    assert.match(makeMessageId("News@Acme-Mail.co.uk"), /^<[0-9a-f-]{36}@acme-mail\.co\.uk>$/);
  });

  test("is unique per message", () => {
    assert.notEqual(makeMessageId("a@acme-mail.co.uk"), makeMessageId("a@acme-mail.co.uk"));
  });

  test("falls back to a dotted placeholder for a bad address", () => {
    assert.match(makeMessageId("nobody"), /@localhost\.localdomain>$/);
  });
});

describe("toMailOptions / the message on the wire", () => {
  test("multipart/alternative with text/plain first and text/html last, UTF-8", async () => {
    const message = await raw(base, "Hi Acme (https://acme-mail.co.uk/)\n\nUnsubscribe: https://x");
    assert.match(headerBlock(message), /^Content-Type: multipart\/alternative;/im);
    const textAt = message.search(/Content-Type: text\/plain; charset=utf-8/i);
    const htmlAt = message.search(/Content-Type: text\/html; charset=utf-8/i);
    assert.ok(textAt > 0, "has a text/plain part");
    assert.ok(htmlAt > textAt, "text/html comes after text/plain");
  });

  test("Message-ID at the sender's domain, Date, no X-Mailer", async () => {
    const headers = headerBlock(await raw(base, "Hi"));
    assert.match(headers, /^Message-ID: <[0-9a-f-]{36}@acme-mail\.co\.uk>$/im);
    assert.match(headers, /^Date: Mon, 02 Mar 2026 10:00:00 \+0000$/im);
    assert.doesNotMatch(headers, /^X-Mailer:/im);
    assert.doesNotMatch(headers, /localhost/i);
  });

  test("keeps the one-click List-Unsubscribe headers and Reply-To", async () => {
    const headers = headerBlock(await raw(base, "Hi"));
    assert.match(headers, /^List-Unsubscribe: <https:\/\/marketing\.acme-mail\.co\.uk\/api\/unsubscribe\/abc\?s=x>$/im);
    assert.match(headers, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/im);
    assert.match(headers, /^Reply-To: hello@acme-mail\.co\.uk$/im);
    assert.match(headers, /^From: Acme News <news@acme-mail\.co\.uk>$/im);
  });

  test("plain-text-only email has a single text/plain part", async () => {
    const message = await raw({ ...base, textOnly: true, html: "" }, "Just text");
    const headers = headerBlock(message);
    assert.match(headers, /^Content-Type: text\/plain; charset=utf-8$/im);
    assert.doesNotMatch(message, /text\/html/i);
  });

  test("non-ASCII subject is encoded", async () => {
    const headers = headerBlock(await raw({ ...base, subject: "Café news – été" }, "Hi"));
    assert.match(headers, /^Subject: =\?UTF-8\?/im);
  });

  test("drops header injection and empty headers", () => {
    const opts = toMailOptions(
      { ...base, headers: { "X-Campaign": "a\r\nBcc: evil@example.org", "Bad Name": "x", Empty: "  " } },
      "Hi",
    );
    assert.deepEqual(opts.headers, { "X-Campaign": "a Bcc: evil@example.org" });
  });
});
