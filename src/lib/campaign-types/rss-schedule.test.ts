import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeSchedule, nextRunAfter, parseTime, zonedTimeToUtc } from "./rss-schedule";

describe("zonedTimeToUtc (Europe/London)", () => {
  it("handles GMT and BST", () => {
    assert.equal(zonedTimeToUtc(2026, 1, 15, 8, 0, "Europe/London").toISOString(), "2026-01-15T08:00:00.000Z");
    assert.equal(zonedTimeToUtc(2026, 7, 15, 8, 0, "Europe/London").toISOString(), "2026-07-15T07:00:00.000Z");
  });

  it("a time skipped by the spring change moves to the hour after", () => {
    // 29 March 2026: 01:00 GMT -> 02:00 BST.
    assert.equal(zonedTimeToUtc(2026, 3, 29, 1, 30, "Europe/London").toISOString(), "2026-03-29T01:30:00.000Z");
  });
});

describe("nextRunAfter", () => {
  const daily = { frequency: "daily" as const, weekday: 1, time: "08:00", timeZone: "Europe/London" };

  it("later today, else tomorrow", () => {
    assert.equal(nextRunAfter(new Date("2026-01-15T07:59:00Z"), daily).toISOString(), "2026-01-15T08:00:00.000Z");
    assert.equal(nextRunAfter(new Date("2026-01-15T08:00:00Z"), daily).toISOString(), "2026-01-16T08:00:00.000Z");
  });

  it("keeps the wall-clock time across the clock change", () => {
    // Sat 28 Mar 08:00 GMT, then Sun 29 Mar 08:00 BST (07:00 UTC).
    const first = nextRunAfter(new Date("2026-03-28T07:00:00Z"), daily);
    assert.equal(first.toISOString(), "2026-03-28T08:00:00.000Z");
    assert.equal(nextRunAfter(first, daily).toISOString(), "2026-03-29T07:00:00.000Z");
  });

  it("weekly on the chosen day", () => {
    // 15 Jan 2026 is a Thursday; next Monday is 19 Jan.
    const weekly = { ...daily, frequency: "weekly" as const, weekday: 1 };
    assert.equal(nextRunAfter(new Date("2026-01-15T12:00:00Z"), weekly).toISOString(), "2026-01-19T08:00:00.000Z");
    // On Monday after the time: a week later.
    assert.equal(nextRunAfter(new Date("2026-01-19T09:00:00Z"), weekly).toISOString(), "2026-01-26T08:00:00.000Z");
  });

  it("uses the London date near midnight", () => {
    // 23:30 UTC on 30 June = 00:30 BST on 1 July: the next 08:00 is 1 July.
    assert.equal(nextRunAfter(new Date("2026-06-30T23:30:00Z"), daily).toISOString(), "2026-07-01T07:00:00.000Z");
  });
});

describe("helpers", () => {
  it("parses times and describes schedules", () => {
    assert.deepEqual(parseTime("8:05"), { hour: 8, minute: 5 });
    assert.equal(parseTime("24:00"), null);
    assert.equal(parseTime("abc"), null);
    assert.equal(describeSchedule({ frequency: "weekly", weekday: 1, time: "08:00" }), "Every Monday at 08:00 (UK time)");
  });
});
