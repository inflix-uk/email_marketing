import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkSchedule,
  formatInTimeZone,
  formatUtcOffset,
  isValidTimeZone,
  utcToZonedLocal,
  zonedLocalToUtc,
} from "./schedule";

describe("zonedLocalToUtc", () => {
  it("27 Oct 2026 20:00 Europe/London is 20:00Z (after the clocks go back)", () => {
    assert.equal(zonedLocalToUtc("2026-10-27T20:00", "Europe/London")?.toISOString(), "2026-10-27T20:00:00.000Z");
  });

  it("a summer date in Europe/London is one hour ahead of UTC (BST)", () => {
    assert.equal(zonedLocalToUtc("2026-07-01T09:00", "Europe/London")?.toISOString(), "2026-07-01T08:00:00.000Z");
  });

  it("handles other timezones", () => {
    assert.equal(zonedLocalToUtc("2026-01-15T09:30", "America/New_York")?.toISOString(), "2026-01-15T14:30:00.000Z");
    assert.equal(zonedLocalToUtc("2026-06-15T09:30", "Asia/Kolkata")?.toISOString(), "2026-06-15T04:00:00.000Z");
    assert.equal(zonedLocalToUtc("2026-06-15T09:30", "UTC")?.toISOString(), "2026-06-15T09:30:00.000Z");
  });

  it("rejects a time skipped when the clocks go forward", () => {
    assert.equal(zonedLocalToUtc("2026-03-29T01:30", "Europe/London"), null);
  });

  it("picks the first of a repeated time when the clocks go back", () => {
    assert.equal(zonedLocalToUtc("2026-10-25T01:30", "Europe/London")?.toISOString(), "2026-10-25T00:30:00.000Z");
  });

  it("rejects malformed input and unknown zones", () => {
    assert.equal(zonedLocalToUtc("2026-10-27 20:00", "Europe/London"), null);
    assert.equal(zonedLocalToUtc("2026-13-01T10:00", "Europe/London"), null);
    assert.equal(zonedLocalToUtc("2026-10-27T20:00", "Mars/Olympus"), null);
  });

  it("round-trips through utcToZonedLocal", () => {
    const at = zonedLocalToUtc("2026-12-31T23:45", "Australia/Sydney")!;
    assert.equal(utcToZonedLocal(at, "Australia/Sydney"), "2026-12-31T23:45");
  });
});

describe("offsets and formatting", () => {
  it("shows the UTC offset", () => {
    assert.equal(formatUtcOffset(new Date("2026-07-01T08:00:00Z"), "Europe/London"), "UTC+01:00");
    assert.equal(formatUtcOffset(new Date("2026-10-27T20:00:00Z"), "Europe/London"), "UTC+00:00");
    assert.equal(formatUtcOffset(new Date("2026-01-15T14:30:00Z"), "America/New_York"), "UTC-05:00");
    assert.equal(formatUtcOffset(new Date("2026-06-15T04:00:00Z"), "Asia/Kolkata"), "UTC+05:30");
  });

  it("formats with the timezone and offset", () => {
    const text = formatInTimeZone(new Date("2026-10-27T20:00:00Z"), "Europe/London");
    assert.match(text, /27 Oct 2026/);
    assert.match(text, /20:00/);
    assert.match(text, /Europe\/London \(UTC\+00:00\)$/);
  });

  it("validates timezones", () => {
    assert.ok(isValidTimeZone("Europe/London"));
    assert.ok(!isValidTimeZone("Not/AZone"));
    assert.ok(!isValidTimeZone(""));
  });
});

describe("checkSchedule", () => {
  const now = new Date("2026-10-27T12:00:00Z");

  it("accepts a future time and returns the UTC instant", () => {
    const r = checkSchedule("2026-10-27T20:00", "Europe/London", now);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.at.toISOString(), "2026-10-27T20:00:00.000Z");
      assert.equal(r.timeZone, "Europe/London");
    }
  });

  it("rejects past, missing, too-far and non-existent times", () => {
    assert.deepEqual(checkSchedule("2026-10-27T11:00", "Europe/London", now), { ok: false, error: "Pick a time in the future." });
    assert.equal(checkSchedule("", "Europe/London", now).ok, false);
    assert.equal(checkSchedule("2028-01-01T10:00", "Europe/London", now).ok, false);
    assert.equal(checkSchedule("2027-03-28T01:30", "Europe/London", now).ok, false);
    assert.equal(checkSchedule("2026-10-28T10:00", "Bad/Zone", now).ok, false);
  });

  it("defaults to Europe/London", () => {
    const r = checkSchedule("2026-11-01T09:00", "", now);
    assert.ok(r.ok && r.timeZone === "Europe/London");
  });
});
