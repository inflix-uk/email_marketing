import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Papa from "papaparse";
import { contactsToCsv, csvHeader, csvRows, exportFileName, sortFieldKeys, type ExportContact } from "./csv";

const created = new Date("2026-01-02T03:04:05.000Z");

function parse(csv: string): string[][] {
  assert.equal(csv.charCodeAt(0), 0xfeff, "starts with a BOM");
  return Papa.parse<string[]>(csv.slice(1), { skipEmptyLines: true }).data;
}

describe("contactsToCsv", () => {
  test("writes the base columns plus one column per custom field", () => {
    const rows: ExportContact[] = [
      { email: "jane@example.com", firstName: "Jane", lastName: "Doe", status: "subscribed", createdAt: created, fields: { company: "Acme" }, tags: ["vip", "early bird"] },
      { email: "bob@example.com", firstName: null, lastName: null, status: "pending", createdAt: created, fields: { city: "Leeds" } },
    ];
    assert.deepEqual(parse(contactsToCsv(rows)), [
      ["email", "first_name", "last_name", "status", "created_at", "tags", "city", "company"],
      ["jane@example.com", "Jane", "Doe", "subscribed", "2026-01-02T03:04:05.000Z", "vip, early bird", "", "Acme"],
      ["bob@example.com", "", "", "pending", "2026-01-02T03:04:05.000Z", "", "Leeds", ""],
    ]);
  });

  test("quotes commas/newlines and neutralises spreadsheet formulas", () => {
    const [, row] = parse(
      contactsToCsv([
        { email: "x@example.com", firstName: "=HYPERLINK(1)", lastName: "Smith, Jr", status: "subscribed", createdAt: created, fields: { note: "a\nb" } },
      ]),
    );
    assert.equal(row[1], "'=HYPERLINK(1)");
    assert.equal(row[2], "Smith, Jr");
    assert.equal(row[6], "a\nb");
  });

  test("renames custom fields that clash with base columns", () => {
    const [header] = parse(
      contactsToCsv([{ email: "x@example.com", firstName: null, lastName: null, status: "subscribed", createdAt: created, fields: { status: "vip", tags: "x" } }]),
    );
    assert.deepEqual(header.slice(6), ["field_status", "field_tags"]);
  });

  test("header only when there are no contacts", () => {
    assert.deepEqual(parse(contactsToCsv([])), [["email", "first_name", "last_name", "status", "created_at", "tags"]]);
  });

  test("streaming header + row batches gives the same file", () => {
    const rows = Array.from({ length: 5 }, (_, i): ExportContact => ({
      email: `c${i}@example.com`,
      firstName: i % 2 ? `=cmd${i}` : null,
      lastName: "Smith, Jr",
      status: "subscribed",
      createdAt: created,
      fields: i % 2 ? { company: `Co ${i}` } : { city: "Leeds" },
      tags: i % 2 ? ["vip", "news"] : undefined,
    }));
    const keys = sortFieldKeys(["company", "city", "company"]);
    assert.deepEqual(keys, ["city", "company"]);
    const streamed = csvHeader(keys) + csvRows(rows.slice(0, 2), keys) + csvRows([], keys) + csvRows(rows.slice(2), keys);
    assert.equal(streamed, contactsToCsv(rows));
  });
});

describe("exportFileName", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  test("dated file name, prefixed with the list name when given", () => {
    assert.equal(exportFileName(null, now), "contacts-2026-09-29.csv");
    assert.equal(exportFileName("Spring Newsletter!", now), "spring-newsletter-contacts-2026-09-29.csv");
    assert.equal(exportFileName("???", now), "contacts-2026-09-29.csv");
  });
});
