import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cn, formatDate, formatNumber, formatPercent, isValidEmail, normalizeEmail } from "./utils";

describe("normalizeEmail", () => {
  test("trims and lower-cases", () => {
    assert.equal(normalizeEmail("  Jane.Doe@Example.COM \n"), "jane.doe@example.com");
  });

  test("leaves the local part otherwise untouched", () => {
    assert.equal(normalizeEmail("First.Last+News@Example.co.uk"), "first.last+news@example.co.uk");
  });

  test("is idempotent", () => {
    const once = normalizeEmail(" A@B.COM ");
    assert.equal(normalizeEmail(once), once);
  });
});

describe("isValidEmail", () => {
  for (const email of [
    "jane@example.com",
    "first.last+news@sub.example.co.uk",
    "o'brien@example.ie",
    "UPPER@EXAMPLE.COM",
    "  padded@example.com  ",
    "x@y.io",
  ]) {
    test(`accepts ${JSON.stringify(email)}`, () => assert.equal(isValidEmail(email), true));
  }

  for (const email of [
    "",
    "   ",
    "plainaddress",
    "@example.com",
    "jane@",
    "jane@example",
    "jane@example.c",
    "jane@@example.com",
    "jane doe@example.com",
    "jane@exa mple.com",
    "jane@example.com, bob@example.com",
  ]) {
    test(`rejects ${JSON.stringify(email)}`, () => assert.equal(isValidEmail(email), false));
  }
});

describe("formatPercent", () => {
  test("returns 0% when the denominator is zero or missing", () => {
    assert.equal(formatPercent(0, 0), "0%");
    assert.equal(formatPercent(5, 0), "0%");
    assert.equal(formatPercent(5, NaN), "0%");
  });

  test("returns 0% for a zero numerator", () => {
    assert.equal(formatPercent(0, 250), "0%");
  });

  test("whole numbers at 10% and above", () => {
    assert.equal(formatPercent(1, 10), "10%");
    assert.equal(formatPercent(1, 3), "33%");
    assert.equal(formatPercent(2, 3), "67%");
    assert.equal(formatPercent(1, 1), "100%");
  });

  test("one decimal place below 10%", () => {
    assert.equal(formatPercent(1, 200), "0.5%");
    assert.equal(formatPercent(99, 1000), "9.9%");
    assert.equal(formatPercent(1, 1000), "0.1%");
  });

  test("never rounds to 100% or 0% unless exact", () => {
    assert.equal(formatPercent(999, 1000), "99.9%");
    assert.equal(formatPercent(9999, 10000), "99.9%");
    assert.equal(formatPercent(995, 1000), "99.5%");
    assert.equal(formatPercent(1, 1_000_000), "<0.1%");
  });
});

describe("other helpers", () => {
  test("cn joins truthy class names", () => {
    assert.equal(cn("a", false, null, undefined, "", "b"), "a b");
  });

  test("formatNumber uses UK grouping", () => {
    assert.equal(formatNumber(1234567), "1,234,567");
  });

  test("formatDate shows a dash for missing dates", () => {
    assert.equal(formatDate(null), "—");
    assert.equal(formatDate(undefined), "—");
    assert.equal(formatDate(new Date(Date.UTC(2026, 8, 15, 12))), "15 Sept 2026");
  });
});
