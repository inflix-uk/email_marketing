import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hasChanges, importUpdateSet, newImportedContact } from "./run-import";

const now = new Date("2026-09-29T12:00:00Z");
const current = { firstName: "Jane", lastName: null, fields: { company: "Acme", city: "Leeds" } };

describe("hasChanges", () => {
  test("false when the file adds nothing new", () => {
    assert.equal(hasChanges(current, { email: "j@example.com", fields: {} }), false);
    assert.equal(hasChanges(current, { email: "j@example.com", firstName: "Jane", fields: { company: "Acme" } }), false);
  });

  test("true for a new or different name or field value", () => {
    assert.equal(hasChanges(current, { email: "j@example.com", lastName: "Doe", fields: {} }), true);
    assert.equal(hasChanges(current, { email: "j@example.com", firstName: "Janet", fields: {} }), true);
    assert.equal(hasChanges(current, { email: "j@example.com", fields: { plan: "pro" } }), true);
    assert.equal(hasChanges(current, { email: "j@example.com", fields: { city: "York" } }), true);
  });
});

describe("importUpdateSet", () => {
  test("null when nothing would change", () => {
    assert.equal(importUpdateSet(current, { email: "j@example.com", firstName: "Jane", fields: {} }, now), null);
  });

  test("sets only non-empty values and merges fields key by key", () => {
    assert.deepEqual(importUpdateSet(current, { email: "j@example.com", lastName: "Doe", fields: { plan: "pro" } }, now), {
      lastName: "Doe",
      "fields.plan": "pro",
      updatedAt: now,
    });
  });

  test("never touches status, source, email or list memberships", () => {
    const $set = importUpdateSet(current, { email: "j@example.com", firstName: "X", lastName: "Y", fields: { a: "1" } }, now)!;
    for (const key of ["status", "source", "email", "listIds", "unsubscribedAt", "fields"]) {
      assert.equal(key in $set, false, key);
    }
  });
});

describe("newImportedContact", () => {
  test("is subscribed, from an import, and on the target list", () => {
    const doc = newImportedContact({ email: "new@example.com", firstName: "New", fields: { plan: "pro" } }, "L1", now);
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
        createdAt: now,
        updatedAt: now,
      },
    );
  });

  test("no list chosen: empty listIds", () => {
    assert.deepEqual(newImportedContact({ email: "n@example.com", fields: {} }, null, now).listIds, []);
  });
});
