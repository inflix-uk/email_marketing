import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  contactFormValues,
  contactInputSchema,
  fieldKeyError,
  listInputSchema,
  parseEmailList,
  slugifyFieldKey,
  tagSchema,
} from "./validation";

describe("fieldKeyError", () => {
  test("accepts simple names", () => {
    for (const key of ["company", "City", "plan_2", "utm_source"]) assert.equal(fieldKeyError(key), null);
  });

  test("rejects empty, spaced, punctuated, long and reserved names", () => {
    assert.match(fieldKeyError("")!, /name/);
    assert.match(fieldKeyError("my field")!, /letters, numbers and underscores/);
    assert.match(fieldKeyError("a.b")!, /letters, numbers and underscores/);
    assert.match(fieldKeyError("x".repeat(51))!, /at most/);
    assert.match(fieldKeyError("email")!, /built-in/);
    assert.match(fieldKeyError("First_Name")!, /built-in/);
  });
});

describe("slugifyFieldKey", () => {
  test("makes merge-tag friendly keys", () => {
    assert.equal(slugifyFieldKey("Company Name"), "company_name");
    assert.equal(slugifyFieldKey("  Phone #  "), "phone");
    assert.equal(slugifyFieldKey("E-mail (work)"), "e_mail_work");
    assert.equal(slugifyFieldKey("Café Ünïcödé"), "cafe_unicode");
    assert.equal(slugifyFieldKey("!!!"), "field");
  });

  test("output is always a valid key unless reserved", () => {
    for (const label of ["Company Name", "a".repeat(80), "__x__", "Tel. (home)"]) {
      assert.equal(fieldKeyError(slugifyFieldKey(label)), null, label);
    }
  });
});

describe("contactInputSchema", () => {
  const base = { email: "  Jane@Example.com ", firstName: " Jane ", lastName: "", fields: [], listIds: [] };

  test("normalises email and blanks", () => {
    const parsed = contactInputSchema.parse(base);
    assert.equal(parsed.email, "jane@example.com");
    assert.equal(parsed.firstName, "Jane");
    assert.equal(parsed.lastName, null);
  });

  test("rejects missing or invalid email with a friendly message", () => {
    const missing = contactInputSchema.safeParse({ ...base, email: "  " });
    assert.equal(missing.success, false);
    assert.match(missing.error!.issues[0].message, /required/);
    const invalid = contactInputSchema.safeParse({ ...base, email: "jane@" });
    assert.match(invalid.error!.issues[0].message, /valid email/);
  });

  test("turns field rows into an object, skipping blank rows and empty values", () => {
    const parsed = contactInputSchema.parse({
      ...base,
      fields: [
        { key: " company ", value: " Acme " },
        { key: "", value: "" },
        { key: "city", value: "" },
      ],
    });
    assert.deepEqual(parsed.fields, { company: "Acme" });
  });

  test("rejects unnamed, invalid and duplicate field keys", () => {
    for (const fields of [
      [{ key: "", value: "x" }],
      [{ key: "bad key", value: "x" }],
      [{ key: "email", value: "x" }],
      [
        { key: "a", value: "1" },
        { key: "a", value: "2" },
      ],
    ]) {
      const result = contactInputSchema.safeParse({ ...base, fields });
      assert.equal(result.success, false, JSON.stringify(fields));
      assert.equal(result.error!.issues[0].path[0], "fields");
    }
  });

  test("de-duplicates list ids", () => {
    assert.deepEqual(contactInputSchema.parse({ ...base, listIds: ["a", "b", "a"] }).listIds, ["a", "b"]);
  });

  test("tags default to none and are lower-cased, trimmed and unique", () => {
    assert.deepEqual(contactInputSchema.parse(base).tags, []);
    assert.deepEqual(contactInputSchema.parse({ ...base, tags: [" VIP ", "vip", "", "Early  Bird"] }).tags, ["vip", "early bird"]);
  });

  test("rejects over-long tags, separators inside a tag and too many tags", () => {
    for (const tags of [["x".repeat(51)], ["a,b"], Array.from({ length: 101 }, (_, i) => `t${i}`)]) {
      const result = contactInputSchema.safeParse({ ...base, tags });
      assert.equal(result.success, false, JSON.stringify(tags).slice(0, 40));
      assert.equal(result.error!.issues[0].path[0], "tags");
    }
    assert.equal(contactInputSchema.safeParse({ ...base, tags: ["x".repeat(50)] }).success, true);
  });
});

describe("contactFormValues", () => {
  test("reads tag chips plus the text still typed in the tag box", () => {
    const form = new FormData();
    form.set("email", "jane@example.com");
    form.append("tags", "vip");
    form.append("tags", "news");
    form.set("tagDraft", "Early Bird; VIP");
    const parsed = contactInputSchema.parse(contactFormValues(form));
    assert.deepEqual(parsed.tags, ["vip", "news", "early bird"]);
  });
});

describe("tagSchema", () => {
  test("normalises one tag or explains what is wrong", () => {
    assert.equal(tagSchema.parse("  Webinar  2026 "), "webinar 2026");
    assert.equal(tagSchema.safeParse("   ").success, false);
    assert.equal(tagSchema.safeParse("a;b").success, false);
    assert.match(tagSchema.safeParse("x".repeat(51)).error!.issues[0].message, /at most 50/);
  });
});

describe("listInputSchema", () => {
  test("requires a name and nulls an empty description", () => {
    assert.deepEqual(listInputSchema.parse({ name: " News ", description: " " }), { name: "News", description: null });
    assert.equal(listInputSchema.safeParse({ name: "  ", description: "" }).success, false);
  });
});

describe("parseEmailList", () => {
  test("accepts newlines, commas, semicolons and spaces", () => {
    const result = parseEmailList("a@example.com\nB@Example.com, c@example.com;d@example.com e@example.com\r\n");
    assert.deepEqual(result.emails, ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"]);
    assert.deepEqual(result.invalid, []);
  });

  test("extracts addresses from 'Name <email>' and mailto:", () => {
    const result = parseEmailList("Jane Doe <jane@example.com>\nmailto:bob@example.com");
    assert.deepEqual(result.emails, ["jane@example.com", "bob@example.com"]);
  });

  test("reports invalid entries and counts duplicates", () => {
    const result = parseEmailList("a@example.com\nnot-an-email\nA@EXAMPLE.COM\nBroken <nope>");
    assert.deepEqual(result.emails, ["a@example.com"]);
    assert.deepEqual(result.invalid, ["not-an-email", "Broken <nope>"]);
    assert.equal(result.duplicates, 1);
  });

  test("empty input", () => {
    assert.deepEqual(parseEmailList(" \n , "), { emails: [], invalid: [], duplicates: 0 });
  });
});
