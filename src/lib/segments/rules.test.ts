import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SegmentRule } from "@/db/schema";
import {
  campaignActivityKey,
  daysError,
  fieldPath,
  MAX_RULES,
  parseRuleDate,
  ruleFilter,
  ruleReferences,
  rulesFilter,
  segmentErrors,
  segmentInputSchema,
  segmentRuleSchema,
  type RuleContext,
} from "./rules";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const DAY = 86_400_000;
const ctx: RuleContext = { now: NOW };
const NOBODY = { _id: { $in: [] } };

const filter = (rule: SegmentRule, context: RuleContext = ctx) => ruleFilter(rule, context);

describe("list rules", () => {
  test("in / not_in use contact.listIds", () => {
    assert.deepEqual(filter({ type: "list", op: "in", listId: "L1" }), { listIds: "L1" });
    assert.deepEqual(filter({ type: "list", op: "not_in", listId: "L1" }), { listIds: { $ne: "L1" } });
  });

  test("a deleted list matches nobody, for both ops", () => {
    const context: RuleContext = { now: NOW, existingListIds: new Set(["L1"]) };
    assert.deepEqual(filter({ type: "list", op: "in", listId: "L1" }, context), { listIds: "L1" });
    assert.deepEqual(filter({ type: "list", op: "in", listId: "gone" }, context), NOBODY);
    assert.deepEqual(filter({ type: "list", op: "not_in", listId: "gone" }, context), NOBODY);
  });

  test("no list picked matches nobody", () => {
    assert.deepEqual(filter({ type: "list", op: "in", listId: "" }), NOBODY);
  });
});

describe("tag rules", () => {
  test("has / not_has use contact.tags, lower-cased", () => {
    assert.deepEqual(filter({ type: "tag", op: "has", tag: "vip" }), { tags: "vip" });
    assert.deepEqual(filter({ type: "tag", op: "has", tag: "  VIP " }), { tags: "vip" });
    assert.deepEqual(filter({ type: "tag", op: "not_has", tag: "vip" }), { tags: { $ne: "vip" } });
  });

  test("an empty tag matches nobody", () => {
    assert.deepEqual(filter({ type: "tag", op: "not_has", tag: " " }), NOBODY);
  });
});

describe("field rules", () => {
  test("fieldPath maps built-in names and custom keys", () => {
    assert.equal(fieldPath("email"), "email");
    assert.equal(fieldPath("first_name"), "firstName");
    assert.equal(fieldPath("last_name"), "lastName");
    assert.equal(fieldPath("First_Name"), "firstName");
    assert.equal(fieldPath("company"), "fields.company");
    assert.equal(fieldPath("Job_Title2"), "fields.Job_Title2");
  });

  test("fieldPath rejects keys that could change the query path", () => {
    for (const key of ["", " ", "a.b", "$where", "fields.company", "has space", "x".repeat(51)]) {
      assert.equal(fieldPath(key), null, key);
    }
  });

  test("equals / not_equals are case-insensitive whole-value matches", () => {
    assert.deepEqual(filter({ type: "field", field: "company", op: "equals", value: "Acme" }), {
      "fields.company": { $regex: "^Acme$", $options: "i" },
    });
    assert.deepEqual(filter({ type: "field", field: "first_name", op: "equals", value: "jane" }), {
      firstName: { $regex: "^jane$", $options: "i" },
    });
    assert.deepEqual(filter({ type: "field", field: "last_name", op: "not_equals", value: "Doe" }), {
      lastName: { $not: { $regex: "^Doe$", $options: "i" } },
    });
  });

  test("email equals / not_equals compare the stored lower-case address exactly", () => {
    assert.deepEqual(filter({ type: "field", field: "email", op: "equals", value: " Jane@Example.com " }), {
      email: "jane@example.com",
    });
    assert.deepEqual(filter({ type: "field", field: "email", op: "not_equals", value: "Jane@Example.com" }), {
      email: { $ne: "jane@example.com" },
    });
  });

  test("contains / starts_with", () => {
    assert.deepEqual(filter({ type: "field", field: "email", op: "contains", value: "@example.com" }), {
      email: { $regex: "@example\\.com", $options: "i" },
    });
    assert.deepEqual(filter({ type: "field", field: "city", op: "starts_with", value: "Lee" }), {
      "fields.city": { $regex: "^Lee", $options: "i" },
    });
  });

  test("regex characters in the value are escaped", () => {
    const value = "a.b*c+d?(e)[f]{g}|h^i$j\\k";
    const escaped = "a\\.b\\*c\\+d\\?\\(e\\)\\[f\\]\\{g\\}\\|h\\^i\\$j\\\\k";
    assert.deepEqual(filter({ type: "field", field: "company", op: "contains", value }), {
      "fields.company": { $regex: escaped, $options: "i" },
    });
    assert.deepEqual(filter({ type: "field", field: "company", op: "equals", value }), {
      "fields.company": { $regex: `^${escaped}$`, $options: "i" },
    });
    assert.deepEqual(filter({ type: "field", field: "company", op: "starts_with", value: ".*" }), {
      "fields.company": { $regex: "^\\.\\*", $options: "i" },
    });
    // The escaped pattern really is literal.
    assert.equal(new RegExp(`^${escaped}$`, "i").test(value), true);
    assert.equal(new RegExp("^\\.\\*", "i").test("anything"), false);
  });

  test("exists / not_exists treat missing, null and empty text as no value", () => {
    assert.deepEqual(filter({ type: "field", field: "company", op: "exists" }), {
      "fields.company": { $nin: [null, ""] },
    });
    assert.deepEqual(filter({ type: "field", field: "first_name", op: "not_exists" }), {
      firstName: { $in: [null, ""] },
    });
  });

  test("a comparison without a value, or an invalid field, matches nobody", () => {
    assert.deepEqual(filter({ type: "field", field: "company", op: "equals" }), NOBODY);
    assert.deepEqual(filter({ type: "field", field: "company", op: "not_equals", value: "  " }), NOBODY);
    assert.deepEqual(filter({ type: "field", field: "a.b", op: "exists" }), NOBODY);
    assert.deepEqual(filter({ type: "field", field: "$where", op: "contains", value: "x" }), NOBODY);
  });
});

describe("created rules", () => {
  test("in_last_days counts back from now", () => {
    assert.deepEqual(filter({ type: "created", op: "in_last_days", value: "30" }), {
      createdAt: { $gte: new Date(NOW.getTime() - 30 * DAY) },
    });
  });

  test("before / after a calendar day exclude that day", () => {
    assert.deepEqual(filter({ type: "created", op: "before", value: "2026-03-01" }), {
      createdAt: { $lt: new Date("2026-03-01T00:00:00.000Z") },
    });
    assert.deepEqual(filter({ type: "created", op: "after", value: "2026-03-01" }), {
      createdAt: { $gte: new Date("2026-03-02T00:00:00.000Z") },
    });
  });

  test("before / after a full timestamp use that exact moment", () => {
    const at = new Date("2026-03-01T10:30:00.000Z");
    assert.deepEqual(filter({ type: "created", op: "before", value: at.toISOString() }), { createdAt: { $lt: at } });
    assert.deepEqual(filter({ type: "created", op: "after", value: at.toISOString() }), { createdAt: { $gt: at } });
  });

  test("bad values match nobody", () => {
    assert.deepEqual(filter({ type: "created", op: "in_last_days", value: "soon" }), NOBODY);
    assert.deepEqual(filter({ type: "created", op: "in_last_days", value: "0" }), NOBODY);
    assert.deepEqual(filter({ type: "created", op: "before", value: "yesterday" }), NOBODY);
    assert.deepEqual(filter({ type: "created", op: "after", value: "2026-02-31" }), NOBODY);
  });

  test("parseRuleDate / daysError", () => {
    assert.equal(parseRuleDate("2026-02-31"), null);
    assert.equal(parseRuleDate("01/03/2026"), null);
    assert.equal(parseRuleDate("2026-03-01")?.wholeDay, true);
    assert.equal(daysError("30"), null);
    assert.equal(daysError(7), null);
    for (const bad of ["", "abc", "1.5", "-3", "0", "99999", null, undefined, true]) {
      assert.equal(typeof daysError(bad), "string", String(bad));
    }
  });
});

describe("activity rules", () => {
  const since = new Date(NOW.getTime() - 14 * DAY);

  test("last_days scope uses the contact's last opened / clicked time", () => {
    assert.deepEqual(filter({ type: "activity", activity: "opened", scope: "last_days", days: 14 }), {
      lastOpenedAt: { $gte: since },
    });
    assert.deepEqual(filter({ type: "activity", activity: "clicked", scope: "last_days", days: 14 }), {
      lastClickedAt: { $gte: since },
    });
  });

  test("not_opened / not_clicked in the last days also match contacts with no activity at all", () => {
    assert.deepEqual(filter({ type: "activity", activity: "not_opened", scope: "last_days", days: 14 }), {
      lastOpenedAt: { $not: { $gte: since } },
    });
    assert.deepEqual(filter({ type: "activity", activity: "not_clicked", scope: "last_days", days: 14 }), {
      lastClickedAt: { $not: { $gte: since } },
    });
  });

  test("last_days without a valid number of days matches nobody", () => {
    assert.deepEqual(filter({ type: "activity", activity: "opened", scope: "last_days" }), NOBODY);
    assert.deepEqual(filter({ type: "activity", activity: "not_opened", scope: "last_days", days: 0 }), NOBODY);
  });

  test("campaign scope becomes _id $in the resolved contact ids, per activity", () => {
    const campaignContactIds = new Map([
      [campaignActivityKey("C1", "opened"), ["a", "b"]],
      [campaignActivityKey("C1", "clicked"), ["a"]],
      [campaignActivityKey("C1", "not_opened"), ["c"]],
      [campaignActivityKey("C1", "not_clicked"), ["b", "c"]],
    ]);
    const context: RuleContext = { now: NOW, campaignContactIds };
    const ids = (activity: "opened" | "clicked" | "not_opened" | "not_clicked") =>
      filter({ type: "activity", activity, scope: "campaign", campaignId: "C1" }, context);
    assert.deepEqual(ids("opened"), { _id: { $in: ["a", "b"] } });
    assert.deepEqual(ids("clicked"), { _id: { $in: ["a"] } });
    assert.deepEqual(ids("not_opened"), { _id: { $in: ["c"] } });
    assert.deepEqual(ids("not_clicked"), { _id: { $in: ["b", "c"] } });
  });

  test("a deleted / unresolved campaign matches nobody", () => {
    const context: RuleContext = { now: NOW, campaignContactIds: new Map() };
    assert.deepEqual(filter({ type: "activity", activity: "not_opened", scope: "campaign", campaignId: "gone" }, context), NOBODY);
    assert.deepEqual(filter({ type: "activity", activity: "opened", scope: "campaign", campaignId: "C1" }), NOBODY);
    assert.deepEqual(filter({ type: "activity", activity: "opened", scope: "campaign" }, context), NOBODY);
  });
});

describe("rulesFilter", () => {
  const rules: SegmentRule[] = [
    { type: "list", op: "in", listId: "L1" },
    { type: "tag", op: "has", tag: "vip" },
  ];

  test("all -> $and, any -> $or", () => {
    assert.deepEqual(rulesFilter("all", rules, ctx), { $and: [{ listIds: "L1" }, { tags: "vip" }] });
    assert.deepEqual(rulesFilter("any", rules, ctx), { $or: [{ listIds: "L1" }, { tags: "vip" }] });
  });

  test("no rules match nobody", () => {
    assert.deepEqual(rulesFilter("all", [], ctx), NOBODY);
    assert.deepEqual(rulesFilter("any", [], ctx), NOBODY);
  });

  test("never adds a status condition", () => {
    assert.equal(JSON.stringify(rulesFilter("all", rules, ctx)).includes("status"), false);
  });

  test("an unknown rule type matches nobody instead of everybody", () => {
    const unknown = { type: "birthday", op: "today" } as unknown as SegmentRule;
    assert.deepEqual(ruleFilter(unknown, ctx), NOBODY);
    assert.deepEqual(rulesFilter("all", [rules[0], unknown], ctx), { $and: [{ listIds: "L1" }, NOBODY] });
  });

  test("each call returns its own objects (safe to modify)", () => {
    const first = rulesFilter("all", [], ctx) as Record<string, unknown>;
    first.status = "subscribed";
    assert.deepEqual(rulesFilter("all", [], ctx), NOBODY);
  });
});

describe("ruleReferences", () => {
  test("collects lists and campaign activities once each", () => {
    const refs = ruleReferences([
      { type: "list", op: "in", listId: "L1" },
      { type: "list", op: "not_in", listId: "L1" },
      { type: "list", op: "in", listId: "L2" },
      { type: "activity", activity: "opened", scope: "campaign", campaignId: "C1" },
      { type: "activity", activity: "opened", scope: "campaign", campaignId: "C1" },
      { type: "activity", activity: "not_opened", scope: "campaign", campaignId: "C1" },
      { type: "activity", activity: "opened", scope: "last_days", days: 3 },
      { type: "tag", op: "has", tag: "vip" },
    ]);
    assert.deepEqual(refs.listIds, ["L1", "L2"]);
    assert.deepEqual(refs.campaignIds, ["C1"]);
    assert.deepEqual(refs.campaignActivities, [
      { campaignId: "C1", activity: "opened" },
      { campaignId: "C1", activity: "not_opened" },
    ]);
  });
});

describe("validation", () => {
  const parse = (rule: unknown) => segmentRuleSchema.safeParse(rule);
  const message = (rule: unknown) => {
    const result = parse(rule);
    return result.success ? null : result.error.issues[0].message;
  };

  test("accepts every rule type and stores only what the rule uses", () => {
    assert.deepEqual(parse({ type: "list", op: "in", listId: " L1 ", extra: 1 }).data, { type: "list", op: "in", listId: "L1" });
    assert.deepEqual(parse({ type: "tag", op: "not_has", tag: " VIP " }).data, { type: "tag", op: "not_has", tag: "vip" });
    assert.deepEqual(parse({ type: "field", field: "company", op: "contains", value: " Acme " }).data, {
      type: "field",
      field: "company",
      op: "contains",
      value: "Acme",
    });
    assert.deepEqual(parse({ type: "field", field: "company", op: "exists", value: "left over" }).data, {
      type: "field",
      field: "company",
      op: "exists",
    });
    assert.deepEqual(parse({ type: "created", op: "in_last_days", value: 30 }).data, { type: "created", op: "in_last_days", value: "30" });
    assert.deepEqual(parse({ type: "created", op: "after", value: "2026-03-01" }).data, { type: "created", op: "after", value: "2026-03-01" });
    assert.deepEqual(parse({ type: "activity", activity: "opened", scope: "last_days", days: "14", campaignId: "C1" }).data, {
      type: "activity",
      activity: "opened",
      scope: "last_days",
      days: 14,
    });
    assert.deepEqual(parse({ type: "activity", activity: "not_opened", scope: "campaign", campaignId: "C1", days: "" }).data, {
      type: "activity",
      activity: "not_opened",
      scope: "campaign",
      campaignId: "C1",
    });
  });

  test("rejects unknown and incomplete rules with a friendly message", () => {
    assert.equal(message({ type: "birthday" }), "Choose what this rule is about.");
    assert.equal(message(null), "Choose what this rule is about.");
    assert.equal(message({ type: "list", op: "in", listId: "" }), "Pick a list.");
    assert.equal(message({ type: "list", op: "maybe", listId: "L1" }), "Choose “is on” or “is not on”.");
    assert.equal(message({ type: "tag", op: "has", tag: "  " }), "Pick a tag.");
    assert.equal(message({ type: "field", field: "", op: "exists" }), "Pick a field.");
    assert.equal(message({ type: "field", field: "a.b", op: "exists" }), "Field names can only contain letters, numbers and underscores (max 50).");
    assert.equal(message({ type: "field", field: "company", op: "equals", value: " " }), "Type the text to look for.");
    assert.equal(message({ type: "field", field: "company", op: "matches", value: "x" }), "Choose how to compare the field.");
    assert.equal(message({ type: "created", op: "in_last_days", value: "" }), "Enter a number of days.");
    assert.equal(message({ type: "created", op: "before", value: "next week" }), "Pick a date.");
    assert.equal(message({ type: "activity", activity: "opened", scope: "last_days", days: "0" }), "Enter 1 day or more.");
    assert.equal(message({ type: "activity", activity: "opened", scope: "campaign" }), "Pick a campaign.");
    assert.equal(message({ type: "activity", activity: "slept", scope: "campaign", campaignId: "C1" }), "Choose what the contact did.");
  });

  test("segment input: name, description, match and rule limits", () => {
    const rule = { type: "tag", op: "has", tag: "vip" };
    const ok = segmentInputSchema.safeParse({ name: " VIPs ", description: " ", match: "any", rules: [rule] });
    assert.deepEqual(ok.data, { name: "VIPs", description: null, match: "any", rules: [rule] });

    const bad = segmentInputSchema.safeParse({
      name: "",
      description: "",
      match: "all",
      rules: [rule, { type: "list", op: "in", listId: "" }, { type: "nope" }],
    });
    assert.equal(bad.success, false);
    assert.deepEqual(segmentErrors(bad.error!), {
      name: "Give the segment a name.",
      ruleErrors: { 1: "Pick a list.", 2: "Choose what this rule is about." },
    });

    const none = segmentInputSchema.safeParse({ name: "x", description: "", match: "all", rules: [] });
    assert.deepEqual(segmentErrors(none.error!), { rules: "Add at least one rule." });

    const many = segmentInputSchema.safeParse({ name: "x", description: "", match: "all", rules: Array(MAX_RULES + 1).fill(rule) });
    assert.deepEqual(segmentErrors(many.error!), { rules: `A segment can have at most ${MAX_RULES} rules.` });

    const match = segmentInputSchema.safeParse({ name: "x", description: "", match: "some", rules: [rule] });
    assert.equal(segmentErrors(match.error!).match, "Choose whether contacts must match all rules or any rule.");
  });
});
