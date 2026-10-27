import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildAuditEntry, formatDetails, sanitizeDetails } from "./audit";

describe("sanitizeDetails", () => {
  test("drops secret-looking keys at any depth", () => {
    const clean = sanitizeDetails({
      host: "smtp.example.com",
      pass: "hunter2",
      smtpPassword: "x",
      apiKey: "k",
      nested: { token: "t", user: "me", secret: "s" },
    });
    assert.deepEqual(clean, { host: "smtp.example.com", nested: { user: "me" } });
  });

  test("cuts long strings and arrays", () => {
    const clean = sanitizeDetails({ s: "a".repeat(1000), list: Array.from({ length: 80 }, (_, i) => i) })!;
    assert.equal((clean.s as string).length, 503);
    assert.equal((clean.list as number[]).length, 50);
  });

  test("empty or missing is null", () => {
    assert.equal(sanitizeDetails(null), null);
    assert.equal(sanitizeDetails({}), null);
    assert.equal(sanitizeDetails({ password: "x" }), null);
  });
});

describe("buildAuditEntry", () => {
  test("fills actor and object fields", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const entry = buildAuditEntry({ userId: "u1", email: "a@b.co" }, "campaign.send", { type: "campaign", id: "c1", details: { queued: 3 } }, now);
    assert.equal(entry.actorId, "u1");
    assert.equal(entry.actorEmail, "a@b.co");
    assert.equal(entry.action, "campaign.send");
    assert.equal(entry.objectType, "campaign");
    assert.equal(entry.objectId, "c1");
    assert.deepEqual(entry.details, { queued: 3 });
    assert.equal(entry.createdAt, now);
    assert.ok(entry._id);
  });

  test("system actions have no actor", () => {
    const entry = buildAuditEntry(null, "x", { type: "y" });
    assert.equal(entry.actorId, null);
    assert.equal(entry.actorEmail, null);
    assert.equal(entry.objectId, null);
    assert.equal(entry.details, null);
  });
});

describe("formatDetails", () => {
  test("joins key/value pairs", () => {
    assert.equal(formatDetails({ role: "editor", count: 2 }), "role: editor, count: 2");
    assert.equal(formatDetails(null), "");
  });
});
