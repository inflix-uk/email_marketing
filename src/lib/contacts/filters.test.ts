import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  contactFilter,
  contactSearchFilter,
  escapeRegex,
  filtersToSearchParams,
  hasFilters,
  parseContactFilters,
  parsePage,
} from "./filters";

describe("parseContactFilters", () => {
  test("reads q, status and list", () => {
    assert.deepEqual(parseContactFilters({ q: "  jane ", status: "bounced", list: "abc" }), {
      q: "jane",
      status: "bounced",
      listId: "abc",
    });
  });

  test("drops blanks and unknown statuses", () => {
    assert.deepEqual(parseContactFilters({ q: " ", status: "deleted" }), {
      q: undefined,
      status: undefined,
      listId: undefined,
    });
  });

  test("accepts URLSearchParams and repeated params", () => {
    assert.equal(parseContactFilters(new URLSearchParams("q=bob&status=subscribed")).status, "subscribed");
    assert.equal(parseContactFilters({ q: ["first", "second"] }).q, "first");
  });
});

describe("parsePage", () => {
  test("defaults to 1 for missing or bad values", () => {
    assert.equal(parsePage(undefined), 1);
    assert.equal(parsePage("0"), 1);
    assert.equal(parsePage("-3"), 1);
    assert.equal(parsePage("abc"), 1);
    assert.equal(parsePage("4"), 4);
  });
});

describe("filtersToSearchParams", () => {
  test("round-trips filters and omits page 1", () => {
    const f = { q: "a b", status: "subscribed" as const, listId: "L1" };
    assert.equal(filtersToSearchParams(f, 1).toString(), "q=a+b&status=subscribed&list=L1");
    assert.equal(filtersToSearchParams({}, 3).toString(), "page=3");
    assert.deepEqual(parseContactFilters(filtersToSearchParams(f)), f);
  });

  test("hasFilters", () => {
    assert.equal(hasFilters({}), false);
    assert.equal(hasFilters({ status: "bounced" }), true);
  });
});

describe("escapeRegex", () => {
  test("user input matches literally", () => {
    for (const term of ["a.b", "(x)", "c++", "50%", "[a-z]*", "back\\slash", "^$|?{}"]) {
      const re = new RegExp(escapeRegex(term), "i");
      assert.ok(re.test(`before ${term} after`), term);
    }
    assert.equal(new RegExp(escapeRegex("a.b")).test("axb"), false);
  });
});

describe("contactFilter", () => {
  test("no filters matches everything", () => {
    assert.deepEqual(contactFilter({}), {});
  });

  test("status and list become equality matches (list via the listIds array)", () => {
    assert.deepEqual(contactFilter({ status: "bounced", listId: "L1" }), { status: "bounced", listIds: "L1" });
  });

  test("search is an escaped, case-insensitive contains over email and names", () => {
    const filter = contactFilter({ q: "jo.n", status: "subscribed" });
    const contains = { $regex: "jo\\.n", $options: "i" };
    assert.deepEqual(filter, {
      status: "subscribed",
      $or: [{ email: contains }, { firstName: contains }, { lastName: contains }],
    });
  });

  test("a term with a space also matches the full name", () => {
    const filter = contactSearchFilter("jane d") as { $or: object[] };
    assert.equal(filter.$or.length, 4);
    assert.deepEqual(filter.$or[3], {
      $expr: {
        $regexMatch: {
          input: { $concat: [{ $ifNull: ["$firstName", ""] }, " ", { $ifNull: ["$lastName", ""] }] },
          regex: "jane d",
          options: "i",
        },
      },
    });
  });
});
