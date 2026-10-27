import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { csvCell, csvLine, reportFileName, reportToCsv } from "./report-csv";
import { emptyCounts } from "./rollup";

describe("csvCell", () => {
  test("plain text and numbers are unchanged", () => {
    assert.equal(csvCell("Spring sale"), "Spring sale");
    assert.equal(csvCell(42), "42");
    assert.equal(csvCell(-3), "-3");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(Number.NaN), "");
  });

  test("quotes commas, quotes and line breaks", () => {
    assert.equal(csvCell('Say "hi", friend'), '"Say ""hi"", friend"');
    assert.equal(csvCell("a\nb"), '"a\nb"');
  });

  test("formula-like text is neutralised", () => {
    assert.equal(csvCell("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
    assert.equal(csvCell("+1"), `"'+1"`);
    assert.equal(csvCell("-1"), `"'-1"`);
    assert.equal(csvCell("@SUM(A1)"), `"'@SUM(A1)"`);
    assert.equal(csvCell("\tx"), `"'\tx"`);
  });

  test("csvLine ends with CRLF", () => {
    assert.equal(csvLine(["a", 1, "=b"]), `a,1,"'=b"\r\n`);
  });
});

describe("reportToCsv", () => {
  const csv = reportToCsv({
    scope: "List: =evil",
    range: { from: "2026-10-01", to: "2026-10-27" },
    groupLabel: "Campaign",
    generatedAt: new Date("2026-10-27T12:00:00Z"),
    rows: [
      {
        key: "c1",
        label: "=cmd|' /C calc'!A0",
        campaignId: "c1",
        counts: { ...emptyCounts(), campaigns: 1, sent: 200, delivered: 200, opens: 50, clicks: 5 },
      },
    ],
    total: { ...emptyCounts(), campaigns: 1, sent: 200, delivered: 200, opens: 50, clicks: 5 },
  });
  const lines = csv.split("\r\n");

  test("header rows: scope, dates, timezone, generated", () => {
    assert.ok(csv.startsWith("﻿"));
    assert.equal(lines[1], "Scope,List: =evil");
    assert.equal(lines[2], "Dates,1 Oct 2026 to 27 Oct 2026");
    assert.equal(lines[3], "Timezone,Europe/London");
    assert.equal(lines[4], 'Generated,"27 Oct 2026, 12:00"');
  });

  test("table with escaped labels, rates in percent and N/A", () => {
    assert.equal(lines[5], "");
    assert.match(lines[6], /^Campaign,Campaigns,Sent,Unique opens,Open rate \(%\)/);
    assert.equal(lines[7], `"'=cmd|' /C calc'!A0",1,200,50,25,5,2.5,10,0,0,0`);
    assert.equal(lines[8], "Total,1,200,50,25,5,2.5,10,0,0,0");
  });

  test("zero denominators export as N/A", () => {
    const empty = reportToCsv({
      scope: "All lists",
      range: { from: "2026-10-01", to: "2026-10-01" },
      groupLabel: "Day",
      generatedAt: new Date(),
      rows: [],
      total: emptyCounts(),
    });
    assert.ok(empty.includes("Total,0,0,0,N/A,0,N/A,N/A,0,0,0"));
  });

  test("file name", () => {
    assert.equal(reportFileName({ from: "2026-10-01", to: "2026-10-27" }), "campaign-results-2026-10-01-to-2026-10-27.csv");
  });
});
