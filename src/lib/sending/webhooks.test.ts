import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAmazonUrl, isWebhookProvider, parseWebhook, type FeedbackEvent } from "./webhooks";

function events(provider: Parameters<typeof parseWebhook>[0], body: unknown): FeedbackEvent[] {
  const parsed = parseWebhook(provider, body);
  assert.ok(parsed.ok, `expected an understood payload, got ${JSON.stringify(parsed)}`);
  return parsed.events;
}

const sns = (message: unknown) => ({
  Type: "Notification",
  MessageId: "22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324",
  TopicArn: "arn:aws:sns:eu-west-2:123456789012:ses-feedback",
  Message: JSON.stringify(message),
});

describe("providers", () => {
  it("knows its providers", () => {
    for (const p of ["ses", "resend", "brevo", "mailgun", "generic"]) assert.ok(isWebhookProvider(p));
    assert.equal(isWebhookProvider("sendgrid"), false);
    assert.equal(isWebhookProvider("constructor"), false);
  });

  it("rejects bodies that aren't JSON objects", () => {
    assert.equal(parseWebhook("brevo", "hello").ok, false);
    assert.equal(parseWebhook("ses", null).ok, false);
  });
});

describe("Amazon SES (SNS)", () => {
  const bounce = (bounceType: string) => ({
    notificationType: "Bounce",
    bounce: {
      bounceType,
      bounceSubType: "General",
      bouncedRecipients: [
        { emailAddress: "Gone@Example.com", status: "5.1.1", diagnosticCode: "smtp; 550 5.1.1 user unknown" },
        { emailAddress: "also-gone@example.com" },
      ],
    },
    mail: { messageId: "0102018f-aaaa-bbbb", destination: ["gone@example.com"] },
  });

  it("permanent bounce: one event per recipient, lower-cased, with reason + message id", () => {
    assert.deepEqual(events("ses", sns(bounce("Permanent"))), [
      { type: "bounce", email: "gone@example.com", reason: "smtp; 550 5.1.1 user unknown", messageId: "0102018f-aaaa-bbbb" },
      { type: "bounce", email: "also-gone@example.com", reason: "Permanent / General", messageId: "0102018f-aaaa-bbbb" },
    ]);
  });

  it("transient and undetermined bounces are ignored", () => {
    assert.deepEqual(events("ses", sns(bounce("Transient"))), []);
    assert.deepEqual(events("ses", sns(bounce("Undetermined"))), []);
  });

  it("complaint", () => {
    const body = sns({
      notificationType: "Complaint",
      complaint: { complainedRecipients: [{ emailAddress: "angry@example.com" }], complaintFeedbackType: "abuse" },
      mail: { messageId: "0102018f-cccc" },
    });
    assert.deepEqual(events("ses", body), [{ type: "complaint", email: "angry@example.com", messageId: "0102018f-cccc" }]);
  });

  it("understands raw message delivery and configuration-set events (eventType)", () => {
    const raw = { eventType: "Bounce", bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "x@example.com" }] }, mail: {} };
    assert.deepEqual(events("ses", raw), [{ type: "bounce", email: "x@example.com", reason: "Permanent" }]);
  });

  it("deliveries and non-SES messages are understood and ignored", () => {
    assert.deepEqual(events("ses", sns({ notificationType: "Delivery", mail: {} })), []);
    assert.deepEqual(events("ses", { Type: "Notification", Message: "Successfully validated SNS topic" }), []);
    assert.deepEqual(events("ses", { Type: "UnsubscribeConfirmation" }), []);
  });

  it("subscription confirmation: only amazonaws.com URLs are returned for fetching", () => {
    const url = "https://sns.eu-west-2.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn&Token=abc";
    assert.deepEqual(parseWebhook("ses", { Type: "SubscriptionConfirmation", SubscribeURL: url }), {
      ok: true,
      events: [],
      confirmUrl: url,
    });
    for (const bad of [
      "https://evil.example.com/?x=.amazonaws.com",
      "https://amazonaws.com.evil.example.com/",
      "https://notamazonaws.com/",
      "http://sns.eu-west-2.amazonaws.com/",
      "not a url",
      undefined,
    ]) {
      assert.equal(parseWebhook("ses", { Type: "SubscriptionConfirmation", SubscribeURL: bad }).ok, false, String(bad));
    }
    assert.equal(isAmazonUrl("https://sns.us-east-1.amazonaws.com/x"), true);
    assert.equal(isAmazonUrl("https://sns.us-east-1.amazonaws.com.evil.test/x"), false);
  });
});

describe("Resend", () => {
  const body = (type: string, bounce?: Record<string, string>) => ({
    type,
    created_at: "2026-01-01T10:00:00.000Z",
    data: { email_id: "56761188-7520-42d8-8898-ff6fc54ce618", to: ["Gone@example.com"], subject: "Hi", bounce },
  });

  it("email.bounced", () => {
    assert.deepEqual(events("resend", body("email.bounced", { type: "Permanent", subType: "General", message: "Mailbox does not exist" })), [
      { type: "bounce", email: "gone@example.com", reason: "Mailbox does not exist", messageId: "56761188-7520-42d8-8898-ff6fc54ce618" },
    ]);
    assert.equal(events("resend", body("email.bounced")).length, 1);
  });

  it("temporary bounces and other events are ignored", () => {
    assert.deepEqual(events("resend", body("email.bounced", { type: "Transient", message: "Mailbox full" })), []);
    assert.deepEqual(events("resend", body("email.delivered")), []);
    assert.deepEqual(events("resend", body("email.delivery_delayed")), []);
  });

  it("email.complained", () => {
    assert.deepEqual(events("resend", body("email.complained")), [
      { type: "complaint", email: "gone@example.com", messageId: "56761188-7520-42d8-8898-ff6fc54ce618" },
    ]);
  });
});

describe("Brevo", () => {
  const body = (event: string) => ({
    event,
    email: "gone@example.com",
    id: 26224,
    date: "2026-01-01 10:00:00",
    "message-id": "<202601011000.1234@smtp-relay.mailin.fr>",
    reason: event === "hard_bounce" ? "550 5.1.1 no such user" : undefined,
  });

  it("hard_bounce, blocked and invalid_email are bounces", () => {
    assert.deepEqual(events("brevo", body("hard_bounce")), [
      { type: "bounce", email: "gone@example.com", reason: "550 5.1.1 no such user", messageId: "<202601011000.1234@smtp-relay.mailin.fr>" },
    ]);
    assert.equal(events("brevo", body("blocked"))[0].type, "bounce");
    assert.equal(events("brevo", body("blocked"))[0].reason, "blocked");
    assert.equal(events("brevo", body("invalid_email"))[0].type, "bounce");
  });

  it("spam / complaint are complaints", () => {
    assert.equal(events("brevo", body("spam"))[0].type, "complaint");
    assert.equal(events("brevo", body("complaint"))[0].type, "complaint");
    assert.equal(events("brevo", body("spam"))[0].reason, undefined);
  });

  it("soft bounces and everything else are ignored", () => {
    for (const e of ["soft_bounce", "deferred", "delivered", "opened", "click", "unsubscribed"]) {
      assert.deepEqual(events("brevo", body(e)), [], e);
    }
  });
});

describe("Mailgun", () => {
  const body = (event: string, severity?: string) => ({
    signature: { timestamp: "1767261600", token: "abc", signature: "def" },
    "event-data": {
      event,
      severity,
      recipient: "gone@example.com",
      reason: "bounce",
      "delivery-status": { code: 550, message: "5.1.1 The email account does not exist", description: "" },
      message: { headers: { "message-id": "20260101100000.1.ABCDEF@mg.example.com" } },
    },
  });

  it("permanent failure is a bounce", () => {
    assert.deepEqual(events("mailgun", body("failed", "permanent")), [
      {
        type: "bounce",
        email: "gone@example.com",
        reason: "5.1.1 The email account does not exist",
        messageId: "20260101100000.1.ABCDEF@mg.example.com",
      },
    ]);
  });

  it("temporary failure is ignored", () => {
    assert.deepEqual(events("mailgun", body("failed", "temporary")), []);
    assert.deepEqual(events("mailgun", body("failed")), []);
  });

  it("complained is a complaint; other events are ignored", () => {
    assert.equal(events("mailgun", body("complained"))[0].type, "complaint");
    assert.deepEqual(events("mailgun", body("delivered")), []);
    assert.deepEqual(events("mailgun", body("opened")), []);
  });
});

describe("generic", () => {
  it("accepts { type, email, reason?, messageId? }", () => {
    assert.deepEqual(events("generic", { type: "bounce", email: " Gone@Example.com ", reason: "no such user", messageId: "<a@b>" }), [
      { type: "bounce", email: "gone@example.com", reason: "no such user", messageId: "<a@b>" },
    ]);
    assert.deepEqual(events("generic", { type: "complaint", email: "x@example.com", reason: "ignored" }), [
      { type: "complaint", email: "x@example.com" },
    ]);
  });

  it("accepts a batch", () => {
    const batch = [
      { type: "bounce", email: "a@example.com" },
      { type: "complaint", email: "b@example.com" },
    ];
    assert.deepEqual(events("generic", batch).map((e) => `${e.type}:${e.email}`), ["bounce:a@example.com", "complaint:b@example.com"]);
  });

  it("rejects unknown types and invalid addresses", () => {
    assert.equal(parseWebhook("generic", { type: "soft_bounce", email: "a@example.com" }).ok, false);
    assert.equal(parseWebhook("generic", { type: "bounce", email: "not-an-email" }).ok, false);
    assert.equal(parseWebhook("generic", { type: "bounce" }).ok, false);
    assert.equal(parseWebhook("generic", [{ type: "bounce", email: "a@example.com" }, { type: "nope" }]).ok, false);
  });

  it("truncates very long reasons", () => {
    assert.equal(events("generic", { type: "bounce", email: "a@example.com", reason: "x".repeat(5000) })[0].reason?.length, 500);
  });
});
