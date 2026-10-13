import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeRule, describeRules, fieldLabel, type RuleNames } from "./summary";

const names: RuleNames = {
  lists: new Map([["L1", "Newsletter"]]),
  campaigns: new Map([["C1", "Spring sale"]]),
};

describe("describeRule", () => {
  test("lists, including deleted ones", () => {
    assert.equal(describeRule({ type: "list", op: "in", listId: "L1" }, names), "on the list “Newsletter”");
    assert.equal(describeRule({ type: "list", op: "not_in", listId: "L1" }, names), "not on the list “Newsletter”");
    assert.equal(describeRule({ type: "list", op: "in", listId: "gone" }, names), "on a deleted list");
    assert.equal(describeRule({ type: "list", op: "not_in", listId: "gone" }), "not on a deleted list");
  });

  test("tags", () => {
    assert.equal(describeRule({ type: "tag", op: "has", tag: "vip" }), "tagged “vip”");
    assert.equal(describeRule({ type: "tag", op: "not_has", tag: "vip" }), "not tagged “vip”");
  });

  test("fields", () => {
    assert.equal(fieldLabel("first_name"), "first name");
    assert.equal(describeRule({ type: "field", field: "company", op: "equals", value: "Acme" }), "company is “Acme”");
    assert.equal(describeRule({ type: "field", field: "last_name", op: "not_equals", value: "Doe" }), "last name is not “Doe”");
    assert.equal(describeRule({ type: "field", field: "email", op: "contains", value: "@example.com" }), "email contains “@example.com”");
    assert.equal(describeRule({ type: "field", field: "city", op: "starts_with", value: "Lee" }), "city starts with “Lee”");
    assert.equal(describeRule({ type: "field", field: "company", op: "exists" }), "company is filled in");
    assert.equal(describeRule({ type: "field", field: "first_name", op: "not_exists" }), "first name is empty");
  });

  test("date added", () => {
    assert.equal(describeRule({ type: "created", op: "in_last_days", value: "30" }), "added in the last 30 days");
    assert.equal(describeRule({ type: "created", op: "in_last_days", value: "1" }), "added in the last day");
    assert.equal(describeRule({ type: "created", op: "before", value: "2026-03-01" }), "added before 1 Mar 2026");
    assert.equal(describeRule({ type: "created", op: "after", value: "2026-03-01" }), "added after 1 Mar 2026");
    assert.equal(describeRule({ type: "created", op: "after", value: "junk" }), "added after an unknown date");
  });

  test("activity in the last days", () => {
    assert.equal(describeRule({ type: "activity", activity: "opened", scope: "last_days", days: 30 }), "opened an email in the last 30 days");
    assert.equal(describeRule({ type: "activity", activity: "clicked", scope: "last_days", days: 7 }), "clicked a link in the last 7 days");
    assert.equal(
      describeRule({ type: "activity", activity: "not_opened", scope: "last_days", days: 90 }),
      "did not open any email in the last 90 days",
    );
    assert.equal(
      describeRule({ type: "activity", activity: "not_clicked", scope: "last_days", days: 90 }),
      "did not click any link in the last 90 days",
    );
  });

  test("activity on one campaign, including a deleted one", () => {
    const rule = (activity: "opened" | "clicked" | "not_opened" | "not_clicked", campaignId = "C1") =>
      describeRule({ type: "activity", activity, scope: "campaign", campaignId }, names);
    assert.equal(rule("opened"), "opened “Spring sale”");
    assert.equal(rule("clicked"), "clicked a link in “Spring sale”");
    assert.equal(rule("not_opened"), "did not open “Spring sale”");
    assert.equal(rule("not_clicked"), "did not click a link in “Spring sale”");
    assert.equal(rule("not_opened", "gone"), "did not open a deleted campaign");
  });

  test("bad data doesn't throw", () => {
    assert.equal(describeRule({ type: "nope" } as never), "unknown rule");
    assert.equal(describeRule(null as never), "unknown rule");
  });
});

describe("describeRules", () => {
  const rules = [
    { type: "list", op: "in", listId: "L1" },
    { type: "activity", activity: "opened", scope: "last_days", days: 30 },
  ] as const;

  test("joins with and / or and capitalises", () => {
    assert.equal(describeRules("all", rules, names), "On the list “Newsletter” and opened an email in the last 30 days");
    assert.equal(describeRules("any", rules, names), "On the list “Newsletter” or opened an email in the last 30 days");
  });

  test("no rules", () => {
    assert.equal(describeRules("all", []), "No rules yet - matches nobody");
  });
});
