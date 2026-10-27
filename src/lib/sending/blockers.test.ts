import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasLineBreak, sendBlockers, type SendCheckInput } from "./blockers";

const ok: SendCheckInput = {
  subject: "Hello",
  html: "<p>Hi</p>",
  fromEmail: "news@zextons.co.uk",
  replyTo: null,
  listCount: 1,
  recipients: 10,
};

describe("sendBlockers", () => {
  it("passes a ready campaign (a missing unsubscribe link is not a blocker)", () => {
    assert.deepEqual(sendBlockers(ok), []);
  });

  it("blocks on empty subject, content, sender, lists and recipients", () => {
    const fields = (input: Partial<SendCheckInput>) => sendBlockers({ ...ok, ...input }).map((b) => b.field);
    assert.deepEqual(fields({ subject: "  " }), ["subject"]);
    assert.deepEqual(fields({ html: "" }), ["source"]);
    assert.deepEqual(fields({ fromEmail: "" }), ["sender"]);
    assert.deepEqual(fields({ fromEmail: "not-an-email" }), ["sender"]);
    assert.deepEqual(fields({ listCount: 0, recipients: 0 }), ["listIds"]);
    assert.deepEqual(fields({ recipients: 0 }), ["listIds"]);
    assert.deepEqual(fields({ replyTo: "a@b.co\r\nBcc: x@y.z" }), ["replyTo"]);
  });

  it("plain-text campaigns need some text", () => {
    assert.deepEqual(
      sendBlockers({ ...ok, format: "text", html: "<p> </p>", textBody: "" }).map((b) => b.field),
      ["source"],
    );
    assert.deepEqual(sendBlockers({ ...ok, format: "text", html: "<p> </p>", textBody: "Hi there" }), []);
  });

  it("detects header injection", () => {
    assert.ok(hasLineBreak("a\nb"));
    assert.ok(!hasLineBreak("a@b.co"));
  });
});
