import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { apiContactSchema, firstIssueMessage, resolveLists } from "./contacts";
import { API_KEY_PREFIX, bearerToken, generateApiKey, hashApiKey } from "./keys";

describe("API keys", () => {
  test("generated keys are random, prefixed and stored as a sha256 hash", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    assert.notEqual(a.key, b.key);
    assert.ok(a.key.startsWith(API_KEY_PREFIX));
    assert.match(a.key, /^ifx_[A-Za-z0-9_-]{43}$/);
    assert.match(a.keyHash, /^[0-9a-f]{64}$/);
    assert.equal(a.keyHash, hashApiKey(a.key));
    assert.equal(a.prefix, a.key.slice(0, 12));
  });

  test("bearerToken", () => {
    assert.equal(bearerToken("Bearer ifx_abc"), "ifx_abc");
    assert.equal(bearerToken("bearer   ifx_abc  "), "ifx_abc");
    assert.equal(bearerToken("Basic abc"), null);
    assert.equal(bearerToken("Bearer"), null);
    assert.equal(bearerToken("Bearer a b"), null);
    assert.equal(bearerToken(null), null);
  });
});

describe("POST /api/v1/contacts input", () => {
  test("normalises email, names, fields, tags and lists", () => {
    const parsed = apiContactSchema.parse({
      email: " Jane@Example.com ",
      first_name: " Jane ",
      last_name: null,
      fields: { company: " Acme ", seats: 5, city: null, plan: "" },
      tags: ["VIP", " vip ", "Webinar 2026"],
      lists: ["Newsletter", "Newsletter", "abc"],
    });
    assert.equal(parsed.email, "jane@example.com");
    assert.equal(parsed.first_name, "Jane");
    assert.equal(parsed.last_name, null);
    assert.deepEqual(parsed.fields, { set: { company: "Acme", seats: "5" }, unset: ["city", "plan"] });
    assert.deepEqual(parsed.tags, ["vip", "webinar 2026"]);
    assert.deepEqual(parsed.lists, ["Newsletter", "abc"]);
  });

  test("omitted names stay undefined (not changed on update)", () => {
    const parsed = apiContactSchema.parse({ email: "jane@example.com" });
    assert.equal(parsed.first_name, undefined);
    assert.equal(parsed.last_name, undefined);
    assert.deepEqual(parsed.fields, { set: {}, unset: [] });
    assert.deepEqual(parsed.tags, []);
    assert.deepEqual(parsed.lists, []);
  });

  test("rejects bad input with a readable message", () => {
    const message = (input: unknown) => {
      const result = apiContactSchema.safeParse(input);
      return result.success ? null : firstIssueMessage(result.error);
    };
    assert.match(message({ email: "nope" }) ?? "", /^email: /);
    assert.match(message({}) ?? "", /^email/);
    assert.match(message({ email: "a@example.com", fields: { "bad key": "x" } }) ?? "", /^fields: /);
    assert.match(message({ email: "a@example.com", fields: { email: "x" } }) ?? "", /built-in/);
    assert.match(message({ email: "a@example.com", tags: ["a,b"] }) ?? "", /^tags: /);
    assert.match(message({ email: "a@example.com", tags: "vip" }) ?? "", /^tags/);
    assert.match(message({ email: "a@example.com", first_name: "x".repeat(101) }) ?? "", /^first_name: /);
    assert.equal(message({ email: "a@example.com", fields: { company: "Acme" } }), null);
  });
});

describe("resolveLists", () => {
  const all = [
    { id: "id-1", name: "Newsletter" },
    { id: "id-2", name: "Customers" },
    { id: "id-3", name: "newsletter" },
  ];

  test("matches ids and case-insensitive names, reports the rest", () => {
    assert.deepEqual(resolveLists(["id-2", "NEWSLETTER", " customers ", "Nope"], all), {
      ids: ["id-2", "id-1"],
      unknown: ["Nope"],
    });
    assert.deepEqual(resolveLists([], all), { ids: [], unknown: [] });
  });
});
