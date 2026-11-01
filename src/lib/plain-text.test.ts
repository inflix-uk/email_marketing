import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentFingerprint, ensureUnsubscribeText, htmlToPlainText, isTextVersionStale } from "./plain-text";

describe("htmlToPlainText", () => {
  it("keeps links as text (url) and drops the hidden preheader", () => {
    const text = htmlToPlainText(
      '<body><div style="display:none">Peek</div><p>Read <a href="https://example.com/a?x=1&amp;y=2">the post</a></p></body>',
    );
    assert.equal(text, "Read the post (https://example.com/a?x=1&y=2)");
  });
});

describe("ensureUnsubscribeText", () => {
  it("appends the unsubscribe link when missing", () => {
    assert.match(ensureUnsubscribeText("Hello", "https://x.test/u/1?s=a"), /Unsubscribe: https:\/\/x\.test\/u\/1\?s=a$/);
  });
  it("leaves text that already has it", () => {
    assert.equal(ensureUnsubscribeText("Bye https://x.test/u/1", "https://x.test/u/1"), "Bye https://x.test/u/1");
  });
});

describe("text version staleness", () => {
  it("is stable and changes with the content", () => {
    assert.equal(contentFingerprint("<p>a</p>"), contentFingerprint("<p>a</p>"));
    assert.notEqual(contentFingerprint("<p>a</p>"), contentFingerprint("<p>b</p>"));
  });
  it("is stale only when a hand-written text exists and the HTML changed", () => {
    const html = "<p>Hi</p>";
    assert.equal(isTextVersionStale(null, null, html), false);
    assert.equal(isTextVersionStale("Hi", contentFingerprint(html), html), false);
    assert.equal(isTextVersionStale("Hi", contentFingerprint(html), "<p>Hello</p>"), true);
    assert.equal(isTextVersionStale("Hi", null, html), true);
  });
});
