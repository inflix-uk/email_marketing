import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  compareMetric,
  emptyCounts,
  formatChange,
  formatMetric,
  groupRows,
  londonDate,
  londonMidnight,
  parseReportQuery,
  periodKeys,
  previousRange,
  rangeBounds,
  ratesOf,
  reportQueryString,
  resolveRange,
  sumCounts,
  weekStart,
  type CampaignCounts,
  type ReportCounts,
} from "./rollup";

const counts = (over: Partial<ReportCounts>): ReportCounts => ({ ...emptyCounts(), campaigns: 1, ...over });

function campaign(id: string, sentAt: string, over: Partial<ReportCounts>): CampaignCounts {
  return { ...counts(over), id, name: `Campaign ${id}`, sentAt: new Date(sentAt) };
}

describe("roll-up rates", () => {
  test("rates come from summed numerators and denominators, not averaged percentages", () => {
    const a = counts({ sent: 100, delivered: 100, opens: 50, clicks: 10 }); // 50% open
    const b = counts({ sent: 900, delivered: 900, opens: 90, clicks: 9 }); // 10% open
    const total = sumCounts([a, b]);
    assert.equal(total.campaigns, 2);
    assert.equal(total.opens, 140);
    const r = ratesOf(total);
    assert.equal(r.openRate, 140 / 1000); // 14%, not the 30% average
    assert.equal(r.clickRate, 19 / 1000);
    assert.equal(r.ctor, 19 / 140);
  });

  test("zero denominators give null (N/A)", () => {
    const r = ratesOf(counts({ sent: 0, delivered: 0 }));
    assert.equal(r.openRate, null);
    assert.equal(r.clickRate, null);
    assert.equal(r.ctor, null);
    assert.equal(formatMetric(null, "rate"), "N/A");
    assert.equal(formatMetric(0.1234, "rate"), "12.3%");
    assert.equal(formatMetric(1234, "count"), "1,234");
  });

  test("CTOR is clicks / opens", () => {
    assert.equal(ratesOf(counts({ delivered: 10, opens: 4, clicks: 1 })).ctor, 0.25);
  });
});

describe("compare with previous period", () => {
  const cur = counts({ sent: 200, delivered: 200, opens: 50, clicks: 10 });
  const prev = counts({ sent: 100, delivered: 100, opens: 20, clicks: 0 });

  test("rates change in percentage points", () => {
    const c = compareMetric(cur, prev, "openRate"); // 25% vs 20%
    assert.equal(c.unit, "pp");
    assert.ok(Math.abs(c.change! - 5) < 1e-9);
    assert.equal(formatChange(c), "+5.0 pp");
  });

  test("counts change in percent", () => {
    const c = compareMetric(cur, prev, "sent");
    assert.equal(c.change, 100);
    assert.equal(formatChange(c), "+100%");
  });

  test("no percent change from a zero baseline", () => {
    const c = compareMetric(cur, prev, "clicks");
    assert.equal(c.change, null);
    assert.equal(formatChange(c), "—");
  });

  test("no pp change when either rate is N/A", () => {
    assert.equal(compareMetric(cur, emptyCounts(), "openRate").change, null);
  });

  test("negative change", () => {
    assert.equal(formatChange(compareMetric(prev, cur, "sent")), "−50%");
  });
});

describe("dates in UK time", () => {
  test("londonDate uses Europe/London", () => {
    assert.equal(londonDate(new Date("2026-07-01T23:30:00Z")), "2026-07-02"); // BST
    assert.equal(londonDate(new Date("2026-01-01T23:30:00Z")), "2026-01-01"); // GMT
  });

  test("londonMidnight handles summer and winter time", () => {
    assert.equal(londonMidnight("2026-07-02").toISOString(), "2026-07-01T23:00:00.000Z");
    assert.equal(londonMidnight("2026-01-02").toISOString(), "2026-01-02T00:00:00.000Z");
    // Day the clocks go back.
    assert.equal(londonMidnight("2026-10-25").toISOString(), "2026-10-24T23:00:00.000Z");
    assert.equal(londonMidnight("2026-10-26").toISOString(), "2026-10-26T00:00:00.000Z");
  });

  test("presets", () => {
    const today = "2026-10-27";
    assert.deepEqual(resolveRange({ range: "7d", from: null, to: null }, today), { from: "2026-10-21", to: today });
    assert.deepEqual(resolveRange({ range: "30d", from: null, to: null }, today), { from: "2026-09-28", to: today });
    assert.deepEqual(resolveRange({ range: "month", from: null, to: null }, today), { from: "2026-10-01", to: today });
    assert.deepEqual(resolveRange({ range: "lastmonth", from: null, to: null }, today), {
      from: "2026-09-01",
      to: "2026-09-30",
    });
    assert.deepEqual(resolveRange({ range: "lastmonth", from: null, to: null }, "2026-01-15"), {
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  test("custom ranges are swapped when reversed and capped", () => {
    assert.deepEqual(resolveRange({ range: "custom", from: "2026-10-10", to: "2026-10-01" }, "2026-10-27"), {
      from: "2026-10-01",
      to: "2026-10-10",
    });
    const capped = resolveRange({ range: "custom", from: "2000-01-01", to: "2026-10-27" }, "2026-10-27");
    assert.equal(capped.to, "2026-10-27");
    assert.equal(capped.from, "2024-10-27");
  });

  test("previous period has equal length and ends the day before", () => {
    assert.deepEqual(previousRange({ from: "2026-10-21", to: "2026-10-27" }), { from: "2026-10-14", to: "2026-10-20" });
    assert.deepEqual(previousRange({ from: "2026-03-01", to: "2026-03-31" }), { from: "2026-01-29", to: "2026-02-28" });
  });

  test("range bounds are [start of first day, start of the day after the last)", () => {
    const b = rangeBounds({ from: "2026-10-25", to: "2026-10-25" });
    assert.equal(b.start.toISOString(), "2026-10-24T23:00:00.000Z");
    assert.equal(b.end.toISOString(), "2026-10-26T00:00:00.000Z"); // 25-hour day
  });
});

describe("grouping", () => {
  test("weeks start on Monday", () => {
    assert.equal(weekStart("2026-10-27"), "2026-10-26"); // Tuesday
    assert.equal(weekStart("2026-10-26"), "2026-10-26"); // Monday
    assert.equal(weekStart("2026-11-01"), "2026-10-26"); // Sunday
  });

  test("periodKeys covers the range including empty periods", () => {
    const r = { from: "2026-09-29", to: "2026-10-02" };
    assert.deepEqual(periodKeys(r, "day"), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    assert.deepEqual(periodKeys(r, "month"), ["2026-09", "2026-10"]);
    assert.deepEqual(periodKeys({ from: "2025-12-15", to: "2026-01-02" }, "month"), ["2025-12", "2026-01"]);
    assert.deepEqual(periodKeys(r, "week"), ["2026-09-28"]);
  });

  test("campaigns are bucketed by their UK send date and summed", () => {
    const range = { from: "2026-07-01", to: "2026-07-03" };
    const rows = groupRows(
      [
        campaign("a", "2026-07-01T10:00:00Z", { sent: 10, delivered: 10, opens: 5 }),
        // 23:30 UTC on 1 July is already 2 July in London.
        campaign("b", "2026-07-01T23:30:00Z", { sent: 30, delivered: 30, opens: 3 }),
        campaign("c", "2026-07-02T09:00:00Z", { sent: 60, delivered: 60, opens: 6 }),
      ],
      "day",
      range,
    );
    assert.deepEqual(
      rows.map((r) => [r.key, r.counts.campaigns, r.counts.sent]),
      [
        ["2026-07-01", 1, 10],
        ["2026-07-02", 2, 90],
        ["2026-07-03", 0, 0],
      ],
    );
    assert.equal(ratesOf(rows[1].counts).openRate, 9 / 90);
    assert.equal(ratesOf(rows[2].counts).openRate, null);
  });

  test("campaign rows are newest first and keep their id", () => {
    const rows = groupRows(
      [campaign("old", "2026-07-01T10:00:00Z", {}), campaign("new", "2026-07-05T10:00:00Z", {})],
      "campaign",
      { from: "2026-07-01", to: "2026-07-31" },
    );
    assert.deepEqual(
      rows.map((r) => r.campaignId),
      ["new", "old"],
    );
  });
});

describe("report query", () => {
  test("defaults and round trip", () => {
    const q = parseReportQuery({});
    assert.equal(q.range, "30d");
    assert.equal(q.group, "campaign");
    assert.deepEqual(q.metrics, ["openRate", "clickRate"]);
    assert.equal(q.compare, false);
    const custom = parseReportQuery({
      range: "custom",
      from: "2026-10-01",
      to: "2026-10-15",
      group: "week",
      list: "abc",
      m1: "sent",
      m2: "",
      compare: "1",
    });
    assert.deepEqual(custom.metrics, ["sent"]);
    assert.deepEqual(parseReportQuery(Object.fromEntries(new URLSearchParams(reportQueryString(custom)))), custom);
  });

  test("bad values fall back", () => {
    const q = parseReportQuery({ range: "forever", group: "year", from: "2026-02-30", m1: "nope", m2: "nope" });
    assert.equal(q.range, "30d");
    assert.equal(q.group, "campaign");
    assert.equal(q.from, null);
    assert.deepEqual(q.metrics, ["openRate", "clickRate"]);
  });

  test("the same metric twice is shown once", () => {
    assert.deepEqual(parseReportQuery({ m1: "ctor", m2: "ctor" }).metrics, ["ctor"]);
  });
});
