import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_TAG_LENGTH, missingTags, normalizeTag, parseTags, splitTags, tagError, uniqueTags } from "./tags";

describe("normalizeTag", () => {
  test("trims, lower-cases and collapses whitespace", () => {
    assert.equal(normalizeTag("  VIP  "), "vip");
    assert.equal(normalizeTag("Early\t  Bird"), "early bird");
    assert.equal(normalizeTag("Webinar-2026"), "webinar-2026");
    assert.equal(normalizeTag("   "), "");
  });
});

describe("tagError", () => {
  test("accepts normal tags up to the length limit", () => {
    for (const tag of ["vip", "webinar-2026", "early bird", "x".repeat(MAX_TAG_LENGTH)]) assert.equal(tagError(tag), null, tag);
  });

  test("rejects empty and over-long tags and separators", () => {
    assert.match(tagError("")!, /Type a tag/);
    assert.match(tagError("x".repeat(MAX_TAG_LENGTH + 1))!, /at most 50/);
    assert.match(tagError("a,b")!, /commas/);
    assert.match(tagError("a;b")!, /commas/);
  });
});

describe("uniqueTags", () => {
  test("normalises, drops blanks and keeps the first of each tag in order", () => {
    assert.deepEqual(uniqueTags([" B ", "a", "b", "", "A", "  "]), ["b", "a"]);
    assert.deepEqual(uniqueTags([]), []);
  });
});

describe("splitTags / parseTags", () => {
  test("split on commas, semicolons and line breaks", () => {
    assert.deepEqual(parseTags("VIP, early bird;news\ncustomer\r\nvip"), ["vip", "early bird", "news", "customer"]);
    assert.deepEqual(parseTags(" , ;; "), []);
    assert.deepEqual(parseTags("single"), ["single"]);
  });

  test("parseTags cuts over-long tags to the limit; splitTags keeps them so they can be reported", () => {
    const long = "y".repeat(MAX_TAG_LENGTH + 20);
    assert.deepEqual(parseTags(`ok, ${long}`), ["ok", "y".repeat(MAX_TAG_LENGTH)]);
    assert.deepEqual(splitTags(`ok, ${long}`), ["ok", long]);
  });

  test("tags that only differ after cutting are merged", () => {
    const base = "z".repeat(MAX_TAG_LENGTH);
    assert.deepEqual(parseTags(`${base}1, ${base}2`), [base]);
  });
});

describe("missingTags", () => {
  test("returns the wanted tags the contact doesn't have yet", () => {
    assert.deepEqual(missingTags(["a", "b"], ["b", "c", "d"]), ["c", "d"]);
    assert.deepEqual(missingTags(["a"], ["a"]), []);
  });

  test("treats a contact without a tags field as having none", () => {
    assert.deepEqual(missingTags(undefined, ["a"]), ["a"]);
    assert.deepEqual(missingTags(null, []), []);
  });
});
