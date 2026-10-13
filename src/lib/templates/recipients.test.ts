import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTestRecipients, testSender } from "./recipients";

describe("parseTestRecipients", () => {
  it("splits on commas, semicolons and whitespace, normalising and de-duplicating", () => {
    assert.deepEqual(parseTestRecipients(" A@Example.com, b@example.com;c@example.com\n a@example.com "), {
      ok: true,
      emails: ["a@example.com", "b@example.com", "c@example.com"],
    });
  });

  it("requires at least one address", () => {
    assert.deepEqual(parseTestRecipients(" , ; "), { ok: false, error: "Enter at least one email address." });
  });

  it("rejects invalid addresses", () => {
    assert.deepEqual(parseTestRecipients("a@example.com, nope"), {
      ok: false,
      error: '"nope" isn\'t a valid email address.',
    });
    const many = parseTestRecipients("x, y@z");
    assert.equal(many.ok, false);
    assert.match(!many.ok ? many.error : "", /x, y@z/);
  });

  it("allows at most 5 addresses", () => {
    const five = Array.from({ length: 5 }, (_, i) => `u${i}@example.com`).join(",");
    assert.equal(parseTestRecipients(five).ok, true);
    const six = `${five},u5@example.com`;
    assert.deepEqual(parseTestRecipients(six), {
      ok: false,
      error: "You can send a test to at most 5 addresses at a time.",
    });
  });
});

describe("testSender", () => {
  it("uses the default sender from settings", () => {
    assert.deepEqual(testSender({ fromName: " Acme ", fromEmail: " news@acme.test " }), {
      name: "Acme",
      email: "news@acme.test",
    });
  });

  it('falls back to "Test" when no from name is set', () => {
    assert.deepEqual(testSender({ fromName: "  ", fromEmail: "" }), { name: "Test", email: "" });
  });
});
