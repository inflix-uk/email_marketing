import type { SegmentRule } from "@/db/schema";
import { parseRuleDate, type SegmentMatch } from "./rules";

// Plain-English descriptions of segment rules, e.g.
// "On the list “Newsletter” and opened an email in the last 30 days".
// Pure - the caller supplies the names of the lists and campaigns involved.

export interface RuleNames {
  lists: ReadonlyMap<string, string>;
  campaigns: ReadonlyMap<string, string>;
}

const NO_NAMES: RuleNames = { lists: new Map(), campaigns: new Map() };

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

const quote = (text: string) => `“${text}”`;
const daysText = (days: unknown) => (Number(days) === 1 ? "day" : `${Number(days) || "?"} days`);

/** "company", "first name" - how a rule's field is shown to people. */
export function fieldLabel(field: string): string {
  const key = field.trim().toLowerCase();
  if (key === "email") return "email";
  if (key === "first_name") return "first name";
  if (key === "last_name") return "last name";
  return field.trim() || "field";
}

/** One rule as a phrase that reads after "Contacts who are / who ...". */
export function describeRule(rule: SegmentRule, names: RuleNames = NO_NAMES): string {
  switch (rule?.type) {
    case "list": {
      const name = names.lists.get(rule.listId);
      const list = name === undefined ? "a deleted list" : `the list ${quote(name)}`;
      return rule.op === "not_in" ? `not on ${list}` : `on ${list}`;
    }
    case "tag":
      return rule.op === "not_has" ? `not tagged ${quote(rule.tag)}` : `tagged ${quote(rule.tag)}`;
    case "field": {
      const label = fieldLabel(rule.field);
      const value = quote(rule.value ?? "");
      switch (rule.op) {
        case "equals":
          return `${label} is ${value}`;
        case "not_equals":
          return `${label} is not ${value}`;
        case "contains":
          return `${label} contains ${value}`;
        case "starts_with":
          return `${label} starts with ${value}`;
        case "exists":
          return `${label} is filled in`;
        case "not_exists":
          return `${label} is empty`;
        default:
          return "unknown rule";
      }
    }
    case "created": {
      if (rule.op === "in_last_days") return `added in the last ${daysText(rule.value)}`;
      const date = parseRuleDate(String(rule.value ?? ""));
      const when = date ? dateFmt.format(date.start) : "an unknown date";
      return rule.op === "before" ? `added before ${when}` : `added after ${when}`;
    }
    case "activity": {
      if (rule.scope === "campaign") {
        const name = rule.campaignId ? names.campaigns.get(rule.campaignId) : undefined;
        const campaign = name === undefined ? "a deleted campaign" : quote(name);
        switch (rule.activity) {
          case "opened":
            return `opened ${campaign}`;
          case "clicked":
            return `clicked a link in ${campaign}`;
          case "not_opened":
            return `did not open ${campaign}`;
          case "not_clicked":
            return `did not click a link in ${campaign}`;
          default:
            return "unknown rule";
        }
      }
      const period = `in the last ${daysText(rule.days)}`;
      switch (rule.activity) {
        case "opened":
          return `opened an email ${period}`;
        case "clicked":
          return `clicked a link ${period}`;
        case "not_opened":
          return `did not open any email ${period}`;
        case "not_clicked":
          return `did not click any link ${period}`;
        default:
          return "unknown rule";
      }
    }
    default:
      return "unknown rule";
  }
}

/** All rules of a segment in one sentence, joined with "and" / "or". */
export function describeRules(match: SegmentMatch, rules: readonly SegmentRule[], names: RuleNames = NO_NAMES): string {
  if (!Array.isArray(rules) || rules.length === 0) return "No rules yet - matches nobody";
  const text = rules.map((rule) => describeRule(rule, names)).join(match === "any" ? " or " : " and ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
