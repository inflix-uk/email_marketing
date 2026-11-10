import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contactSearchFilter } from "./filters";
import {
  cleanSearchTerm,
  emailPrefixFilter,
  escapeRegex,
  exactEmailOf,
  MAX_SEARCH_LENGTH,
  PHONE_FIELD_KEYS,
  phoneClauses,
  phoneDigitsOf,
  phoneOf,
  phonePattern,
} from "./search";

describe("escapeRegex", () => {
  test("escapes every metacharacter so input matches literally", () => {
    const nasty = "a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o";
    const re = new RegExp(`^${escapeRegex(nasty)}$`);
    assert.ok(re.test(nasty));
    assert.ok(!re.test("aXb*c+d?e^f$g{h}i(j)k|l[m]n\\o"));
  });

  test("a catastrophic pattern becomes harmless text", () => {
    assert.equal(escapeRegex("(a+)+$"), "\\(a\\+\\)\\+\\$");
  });
});

describe("exactEmailOf", () => {
  test("a full address is normalised", () => {
    assert.equal(exactEmailOf("  Jane.Doe@Example.COM "), "jane.doe@example.com");
  });

  test("partial input or names are not exact emails", () => {
    for (const term of ["jane", "jane@", "jane@example", "@example.com", "jane doe@example.com", ""]) {
      assert.equal(exactEmailOf(term), null, term);
    }
  });
});

describe("cleanSearchTerm", () => {
  test("trims, caps and ignores non-strings", () => {
    assert.equal(cleanSearchTerm("  bob  "), "bob");
    assert.equal(cleanSearchTerm("x".repeat(500)).length, MAX_SEARCH_LENGTH);
    assert.equal(cleanSearchTerm(undefined), "");
    assert.equal(cleanSearchTerm(42), "");
  });
});

describe("emailPrefixFilter", () => {
  test("anchored, lower-cased and escaped (index-friendly: no i flag)", () => {
    assert.deepEqual(emailPrefixFilter(" Jo.N+1 "), { email: { $regex: "^jo\\.n\\+1" } });
  });
});

describe("phone search", () => {
  test("phone-like terms give their digits", () => {
    assert.equal(phoneDigitsOf("+44 (0)7700-900.123"), "4407700900123");
    assert.equal(phoneDigitsOf("077"), "077");
  });

  test("names, emails and very short numbers are not phone terms", () => {
    for (const term of ["jane", "07a", "12", "jane@example.com", "  "]) {
      assert.equal(phoneDigitsOf(term), null, term);
    }
  });

  test("the pattern ignores separators in the stored number", () => {
    const re = new RegExp(phonePattern("07700900"));
    assert.ok(re.test("07700 900123"));
    assert.ok(re.test("+44 07700-900-123"));
    assert.ok(!re.test("07701 900123"));
  });

  test("clauses cover every phone field, and none for other terms", () => {
    const clauses = phoneClauses("07700 900");
    assert.equal(clauses.length, PHONE_FIELD_KEYS.length);
    assert.deepEqual(clauses[0], { "fields.phone": { $regex: phonePattern("07700900") } });
    assert.deepEqual(phoneClauses("jane"), []);
  });

  test("the table search also matches phone fields for phone-like terms", () => {
    const filter = contactSearchFilter("07700") as { $or: Record<string, unknown>[] };
    assert.ok(filter.$or.some((c) => "fields.mobile" in c));
    const byName = contactSearchFilter("jane") as { $or: Record<string, unknown>[] };
    assert.equal(byName.$or.length, 3);
  });

  test("phoneOf picks the first filled phone-like field", () => {
    assert.equal(phoneOf({ company: "Acme", mobile: " 07700 900123 " }), "07700 900123");
    assert.equal(phoneOf({ phone: "", telephone: "0113 496 0000" }), "0113 496 0000");
    assert.equal(phoneOf({ company: "Acme" }), null);
    assert.equal(phoneOf(undefined), null);
  });
});
