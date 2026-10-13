import type { SegmentRule } from "@/db/schema";

// The rule builder edits "drafts": one flat, all-strings object per row, so
// switching a row's type or operator never loses what was typed. Drafts are
// turned into rule objects when previewing / saving; the server validates them.

export type RuleType = SegmentRule["type"];

export interface RuleDraft {
  /** Stable React key for the row. */
  key: number;
  type: RuleType;
  /** Operator of the list / tag / field / created rule. */
  op: string;
  listId: string;
  tag: string;
  field: string;
  /** True when the field name is typed by hand ("Other field...") rather than picked. */
  customField: boolean;
  value: string;
  /** Number of days for "in the last N days" (date added and activity). */
  days: string;
  /** yyyy-mm-dd for "added before / after". */
  date: string;
  activity: string;
  scope: string;
  campaignId: string;
}

export const BUILT_IN_FIELDS = [
  { key: "email", label: "Email" },
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
] as const;

const DEFAULT_OPS: Record<RuleType, string> = {
  list: "in",
  tag: "has",
  field: "contains",
  created: "in_last_days",
  activity: "",
};

/** A fresh row of the given type with sensible defaults. */
export function newDraft(key: number, type: RuleType = "list"): RuleDraft {
  return {
    key,
    type,
    op: DEFAULT_OPS[type],
    listId: "",
    tag: "",
    field: "email",
    customField: false,
    value: "",
    days: "30",
    date: "",
    activity: "opened",
    scope: "last_days",
    campaignId: "",
  };
}

/** Switch a row to another rule type, keeping what was entered in the other inputs. */
export function withType(draft: RuleDraft, type: RuleType): RuleDraft {
  return { ...draft, type, op: DEFAULT_OPS[type] };
}

/** Saved rule -> editable row. `knownFields` are the field names offered in the dropdown. */
export function draftFromRule(rule: SegmentRule, key: number, knownFields: readonly string[] = []): RuleDraft {
  const draft = newDraft(key, rule.type);
  switch (rule.type) {
    case "list":
      return { ...draft, op: rule.op, listId: rule.listId ?? "" };
    case "tag":
      return { ...draft, op: rule.op, tag: rule.tag ?? "" };
    case "field": {
      const field = rule.field ?? "";
      const builtIn = BUILT_IN_FIELDS.find((f) => f.key === field.toLowerCase());
      return {
        ...draft,
        op: rule.op,
        field: builtIn ? builtIn.key : field,
        customField: !builtIn && !knownFields.includes(field),
        value: rule.value ?? "",
      };
    }
    case "created":
      return rule.op === "in_last_days"
        ? { ...draft, op: rule.op, days: String(rule.value ?? "") }
        : { ...draft, op: rule.op, date: String(rule.value ?? "").slice(0, 10) };
    case "activity":
      return {
        ...draft,
        activity: rule.activity,
        scope: rule.scope,
        days: rule.days === undefined ? draft.days : String(rule.days),
        campaignId: rule.campaignId ?? "",
      };
    default:
      return draft;
  }
}

/** Editable row -> the rule object sent to the server (which validates it). */
export function ruleFromDraft(draft: RuleDraft): Record<string, unknown> {
  switch (draft.type) {
    case "list":
      return { type: "list", op: draft.op, listId: draft.listId };
    case "tag":
      return { type: "tag", op: draft.op, tag: draft.tag };
    case "field":
      return { type: "field", field: draft.field, op: draft.op, value: draft.value };
    case "created":
      return { type: "created", op: draft.op, value: draft.op === "in_last_days" ? draft.days : draft.date };
    case "activity":
      return draft.scope === "campaign"
        ? { type: "activity", activity: draft.activity, scope: "campaign", campaignId: draft.campaignId }
        : { type: "activity", activity: draft.activity, scope: draft.scope, days: draft.days };
  }
}
