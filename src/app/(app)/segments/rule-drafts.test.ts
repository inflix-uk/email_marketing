import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SegmentRule } from "@/db/schema";
import { segmentRuleSchema } from "@/lib/segments/rules";
import { draftFromRule, newDraft, ruleFromDraft, withType } from "./rule-drafts";

const RULES: SegmentRule[] = [
  { type: "list", op: "not_in", listId: "L1" },
  { type: "tag", op: "has", tag: "vip" },
  { type: "field", field: "company", op: "equals", value: "Acme" },
  { type: "field", field: "first_name", op: "not_exists" },
  { type: "created", op: "in_last_days", value: "7" },
  { type: "created", op: "before", value: "2026-03-01" },
  { type: "activity", activity: "clicked", scope: "last_days", days: 14 },
  { type: "activity", activity: "not_opened", scope: "campaign", campaignId: "C1" },
];

describe("rule drafts", () => {
  test("every saved rule survives the trip through the form unchanged", () => {
    for (const rule of RULES) {
      const sent = ruleFromDraft(draftFromRule(rule, 0, ["company"]));
      assert.deepEqual(segmentRuleSchema.parse(sent), rule);
    }
  });

  test("a field that isn't in the dropdown is edited as free text", () => {
    assert.equal(draftFromRule(RULES[2], 0, ["company"]).customField, false);
    assert.equal(draftFromRule(RULES[2], 0, []).customField, true);
    assert.equal(draftFromRule(RULES[3], 0, []).customField, false);
  });

  test("new rows of every type are incomplete or valid, never something else", () => {
    assert.equal(segmentRuleSchema.safeParse(ruleFromDraft(newDraft(1, "list"))).success, false);
    assert.equal(segmentRuleSchema.safeParse(ruleFromDraft(newDraft(1, "tag"))).success, false);
    assert.equal(segmentRuleSchema.safeParse(ruleFromDraft(newDraft(1, "field"))).success, false);
    assert.deepEqual(segmentRuleSchema.parse(ruleFromDraft(newDraft(1, "created"))), { type: "created", op: "in_last_days", value: "30" });
    assert.deepEqual(segmentRuleSchema.parse(ruleFromDraft(newDraft(1, "activity"))), {
      type: "activity",
      activity: "opened",
      scope: "last_days",
      days: 30,
    });
  });

  test("switching type resets the operator and keeps the row key", () => {
    const draft = withType({ ...newDraft(4, "list"), op: "not_in", listId: "L1" }, "tag");
    assert.equal(draft.key, 4);
    assert.equal(draft.op, "has");
    assert.equal(draft.listId, "L1");
  });
});
