import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hasChanges, importUpdateSet, newImportedContact, rowTags } from "./run-import";

const now = new Date("2026-09-29T12:00:00Z");
const current = { firstName: "Jane", lastName: null, fields: { company: "Acme", city: "Leeds" } };

describe("hasChanges", () => {
  test("false when the file adds nothing new", () => {
    assert.equal(hasChanges(current, { email: "j@example.com", fields: {}, tags: [] }), false);
    assert.equal(hasChanges(current, { email: "j@example.com", firstName: "Jane", fields: { company: "Acme" }, tags: [] }), false);
  });

  test("true for a new or different name or field value", () => {
    assert.equal(hasChanges(current, { email: "j@example.com", lastName: "Doe", fields: {}, tags: [] }), true);
    assert.equal(hasChanges(current, { email: "j@example.com", firstName: "Janet", fields: {}, tags: [] }), true);
    assert.equal(hasChanges(current, { email: "j@example.com", fields: { plan: "pro" }, tags: [] }), true);
    assert.equal(hasChanges(current, { email: "j@example.com", fields: { city: "York" }, tags: [] }), true);
  });
});

describe("importUpdateSet", () => {
  test("null when nothing would change", () => {
    assert.equal(importUpdateSet(current, { email: "j@example.com", firstName: "Jane", fields: {}, tags: [] }, now), null);
    // Tags are merged separately ($addToSet), never through this $set.
    assert.equal(importUpdateSet(current, { email: "j@example.com", fields: {}, tags: ["vip"] }, now), null);
  });

  test("sets only non-empty values and merges fields key by key", () => {
    assert.deepEqual(importUpdateSet(current, { email: "j@example.com", lastName: "Doe", fields: { plan: "pro" }, tags: [] }, now), {
      lastName: "Doe",
      "fields.plan": "pro",
      updatedAt: now,
    });
  });

  test("never touches status, source, email, tags, consent or list memberships", () => {
    const $set = importUpdateSet(current, { email: "j@example.com", firstName: "X", lastName: "Y", fields: { a: "1" }, tags: ["vip"] }, now)!;
    for (const key of ["status", "source", "email", "listIds", "unsubscribedAt", "fields", "tags", "consent"]) {
      assert.equal(key in $set, false, key);
    }
  });
});

describe("newImportedContact", () => {
  test("is subscribed, from an import, with an import consent record, and on the target list", () => {
    const doc = newImportedContact({ email: "new@example.com", firstName: "New", fields: { plan: "pro" }, tags: ["vip"] }, "L1", now);
    assert.equal(typeof doc._id, "string");
    assert.deepEqual(
      { ...doc, _id: "x" },
      {
        _id: "x",
        email: "new@example.com",
        firstName: "New",
        lastName: null,
        fields: { plan: "pro" },
        status: "subscribed",
        source: "import",
        listIds: ["L1"],
        unsubscribedAt: null,
        tags: ["vip"],
        consent: { source: "import", at: now },
        createdAt: now,
        updatedAt: now,
      },
    );
  });

  test("no list chosen: empty listIds", () => {
    assert.deepEqual(newImportedContact({ email: "n@example.com", fields: {}, tags: [] }, null, now).listIds, []);
  });

  test("gets the row's tags plus the tags added to everyone", () => {
    const doc = newImportedContact({ email: "n@example.com", fields: {}, tags: ["vip"] }, null, now, ["Webinar-2026", "vip"]);
    assert.deepEqual(doc.tags, ["vip", "webinar-2026"]);
  });
});

describe("rowTags", () => {
  test("merges, normalises and de-duplicates", () => {
    assert.deepEqual(rowTags({ tags: ["a", "b"] }, ["B ", "c"]), ["a", "b", "c"]);
    assert.deepEqual(rowTags({ tags: [] }), []);
  });
});
