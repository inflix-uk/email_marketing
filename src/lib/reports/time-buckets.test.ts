import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bucketKey, bucketsBetween, chooseUnit } from "./time-buckets";

describe("time buckets (Europe/London)", () => {
  test("keys use UK time (BST in summer)", () => {
    assert.equal(bucketKey(new Date("2026-07-01T08:30:00Z"), "hour"), "2026-07-01 09");
    assert.equal(bucketKey(new Date("2026-12-01T08:30:00Z"), "hour"), "2026-12-01 08");
    assert.equal(bucketKey(new Date("2026-07-01T23:30:00Z"), "day"), "2026-07-02");
  });

  test("hourly buckets, inclusive of the last hour", () => {
    const b = bucketsBetween(new Date("2026-12-01T08:00:00Z"), new Date("2026-12-01T10:15:00Z"), "hour");
    assert.deepEqual(
      b.map((x) => x.key),
      ["2026-12-01 08", "2026-12-01 09", "2026-12-01 10"],
    );
    assert.equal(bucketsBetween(new Date("2026-07-01T08:30:00Z"), new Date("2026-07-01T08:40:00Z"), "hour")[0].label, "1 Jul 09:00");
  });

  test("daily buckets across the clocks going back", () => {
    const b = bucketsBetween(new Date("2026-10-24T12:00:00Z"), new Date("2026-10-27T12:00:00Z"), "day");
    assert.deepEqual(
      b.map((x) => x.key),
      ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"],
    );
  });

  test("hour vs day", () => {
    const s = new Date("2026-10-01T00:00:00Z");
    assert.equal(chooseUnit(s, new Date("2026-10-03T00:00:00Z")), "hour");
    assert.equal(chooseUnit(s, new Date("2026-10-10T00:00:00Z")), "day");
  });
});
