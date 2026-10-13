import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cleanContactFilters,
  contactFilter,
  contactSearchFilter,
  escapeRegex,
  filtersToSearchParams,
  hasFilters,
  parseContactFilters,
  parsePage,
} from "./filters";

describe("parseContactFilters", () => {
  test("reads q, status, list and tag", () => {
    assert.deepEqual(parseContactFilters({ q: "  jane ", status: "bounced", list: "abc", tag: "  VIP  Customer " }), {
      q: "jane",
      status: "bounced",
      listId: "abc",
      tag: "vip customer",
    });
  });

  test("accepts the pending status", () => {
    assert.equal(parseContactFilters({ status: "pending" }).status, "pending");
  });

  test("drops blanks and unknown statuses", () => {
    assert.deepEqual(parseContactFilters({ q: " ", status: "deleted", tag: "  " }), {
      q: undefined,
      status: undefined,
      listId: undefined,
      tag: undefined,
    });
  });

  test("accepts URLSearchParams and repeated params", () => {
    assert.equal(parseContactFilters(new URLSearchParams("q=bob&status=subscribed")).status, "subscribed");
    assert.equal(parseContactFilters({ q: ["first", "second"] }).q, "first");
  });
});

describe("cleanContactFilters", () => {
  test("cleans filters sent by the browser the same way as URL params", () => {
    assert.deepEqual(cleanContactFilters({ q: " a ", status: "nope", listId: " L1 ", tag: "News " }), {
      q: "a",
      status: undefined,
      listId: "L1",
      tag: "news",
    });
    assert.deepEqual(cleanContactFilters({}), { q: undefined, status: undefined, listId: undefined, tag: undefined });
  });

  test("cuts over-long search terms and tags", () => {
    const cleaned = cleanContactFilters({ q: "x".repeat(300), tag: "T".repeat(80) });
    assert.equal(cleaned.q!.length, 200);
    assert.equal(cleaned.tag, "t".repeat(50));
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
    const f = { q: "a b", status: "subscribed" as const, listId: "L1", tag: "early bird" };
    assert.equal(filtersToSearchParams(f, 1).toString(), "q=a+b&status=subscribed&list=L1&tag=early+bird");
    assert.equal(filtersToSearchParams({}, 3).toString(), "page=3");
    assert.deepEqual(parseContactFilters(filtersToSearchParams(f)), f);
  });

  test("hasFilters", () => {
    assert.equal(hasFilters({}), false);
    assert.equal(hasFilters({ status: "bounced" }), true);
    assert.equal(hasFilters({ tag: "vip" }), true);
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

  test("a tag matches inside the tags array and combines with the other filters", () => {
    assert.deepEqual(contactFilter({ tag: "vip" }), { tags: "vip" });
    assert.deepEqual(contactFilter({ tag: "vip", status: "pending", listId: "L1" }), {
      status: "pending",
      listIds: "L1",
      tags: "vip",
    });
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
