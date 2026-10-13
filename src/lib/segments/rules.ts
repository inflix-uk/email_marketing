import type { Filter } from "mongodb";
import { z } from "zod";
import type { ContactDoc, SegmentRule } from "@/db/schema";
import { escapeRegex } from "@/lib/contacts/filters";

// Segment rules -> MongoDB filters, plus the zod validation used when a
// segment is saved or previewed. Pure: nothing here touches the database, so
// it is safe to import from client components and tests. Anything a rule needs
// from the database (which lists still exist, who was sent a campaign) is
// looked up first and handed in as a RuleContext (see ./index.ts).

export type SegmentMatch = "all" | "any";

export const MAX_RULES = 20;
export const MAX_DAYS = 3650;
const DAY_MS = 86_400_000;

/** A (fresh) filter that matches no contact. */
export function nobody(): Filter<ContactDoc> {
  return { _id: { $in: [] } };
}

export interface RuleContext {
  /** "Now" for the relative rules (in the last N days). */
  now: Date;
  /** Lists that still exist. A rule about any other list matches nobody. Omit to skip the check. */
  existingListIds?: ReadonlySet<string>;
  /**
   * Contact ids for the campaign-scoped activity rules, keyed by
   * campaignActivityKey(). A missing key (e.g. deleted campaign) matches nobody.
   */
  campaignContactIds?: ReadonlyMap<string, readonly string[]>;
}

type Activity = Extract<SegmentRule, { type: "activity" }>["activity"];

export function campaignActivityKey(campaignId: string, activity: Activity): string {
  return `${activity}:${campaignId}`;
}

// --- Fields -------------------------------------------------------------------

const BUILT_IN_FIELDS: Record<string, "email" | "firstName" | "lastName"> = {
  email: "email",
  first_name: "firstName",
  last_name: "lastName",
};

/** Same character set as custom field names on contacts - also keeps "." and "$" out of query paths. */
const FIELD_KEY_RE = /^[a-zA-Z0-9_]{1,50}$/;

/** Document path for a rule's field ("first_name" -> "firstName", "company" -> "fields.company"), or null if invalid. */
export function fieldPath(field: string): string | null {
  const key = field.trim();
  const builtIn = BUILT_IN_FIELDS[key.toLowerCase()];
  if (builtIn) return builtIn;
  return FIELD_KEY_RE.test(key) ? `fields.${key}` : null;
}

function fieldRuleFilter(rule: Extract<SegmentRule, { type: "field" }>): Filter<ContactDoc> {
  const path = fieldPath(rule.field);
  if (!path) return nobody();

  // Missing, null and "" all count as "no value".
  if (rule.op === "exists") return { [path]: { $nin: [null, ""] } } as Filter<ContactDoc>;
  if (rule.op === "not_exists") return { [path]: { $in: [null, ""] } } as Filter<ContactDoc>;

  const value = (rule.value ?? "").trim();
  if (!value) return nobody();
  const text = escapeRegex(value);
  const regex = (pattern: string) => ({ $regex: pattern, $options: "i" });

  switch (rule.op) {
    case "equals":
      // Emails are stored lower-cased, so an exact (indexed) match is already case-insensitive.
      if (path === "email") return { email: value.toLowerCase() };
      return { [path]: regex(`^${text}$`) } as Filter<ContactDoc>;
    case "not_equals":
      // Also matches contacts that don't have the field at all.
      if (path === "email") return { email: { $ne: value.toLowerCase() } };
      return { [path]: { $not: regex(`^${text}$`) } } as Filter<ContactDoc>;
    case "contains":
      return { [path]: regex(text) } as Filter<ContactDoc>;
    case "starts_with":
      return { [path]: regex(`^${text}`) } as Filter<ContactDoc>;
    default:
      return nobody();
  }
}

// --- Dates --------------------------------------------------------------------

/** Why `value` isn't a usable number of days, or null when it is (a number or digits, 1 to MAX_DAYS). */
export function daysError(value: unknown): string | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!text) return "Enter a number of days.";
  if (!/^\d+$/.test(text)) return "Enter a whole number of days, like 30.";
  const days = Number(text);
  if (days < 1) return "Enter 1 day or more.";
  if (days > MAX_DAYS) return "Use 3,650 days (10 years) or fewer.";
  return null;
}

function parseDays(value: unknown): number | null {
  return daysError(value) === null ? Number(value) : null;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A rule date: "2026-03-01" means that whole day (UTC), a full ISO timestamp
 * means that exact moment. Returns the first and last-plus-one instants.
 */
export function parseRuleDate(value: string): { start: Date; end: Date; wholeDay: boolean } | null {
  const text = value.trim();
  if (DATE_ONLY_RE.test(text)) {
    const start = new Date(`${text}T00:00:00.000Z`);
    // Reject impossible dates such as 2026-02-31 (JS would roll them over).
    if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== text) return null;
    return { start, end: new Date(start.getTime() + DAY_MS), wholeDay: true };
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? null : { start: at, end: at, wholeDay: false };
}

function createdRuleFilter(rule: Extract<SegmentRule, { type: "created" }>, now: Date): Filter<ContactDoc> {
  if (rule.op === "in_last_days") {
    const days = parseDays(rule.value);
    return days ? { createdAt: { $gte: new Date(now.getTime() - days * DAY_MS) } } : nobody();
  }
  const date = parseRuleDate(String(rule.value ?? ""));
  if (!date) return nobody();
  // "before 1 March" = up to the end of February; "after 1 March" = from 2 March.
  if (rule.op === "before") return { createdAt: { $lt: date.start } };
  if (rule.op === "after") return date.wholeDay ? { createdAt: { $gte: date.end } } : { createdAt: { $gt: date.end } };
  return nobody();
}

// --- Activity -----------------------------------------------------------------

function activityRuleFilter(rule: Extract<SegmentRule, { type: "activity" }>, ctx: RuleContext): Filter<ContactDoc> {
  if (rule.scope === "campaign") {
    if (!rule.campaignId) return nobody();
    const ids = ctx.campaignContactIds?.get(campaignActivityKey(rule.campaignId, rule.activity));
    return ids && ids.length > 0 ? { _id: { $in: [...ids] } } : nobody();
  }
  if (rule.scope !== "last_days") return nobody();

  const days = parseDays(rule.days);
  if (!days) return nobody();
  const since = new Date(ctx.now.getTime() - days * DAY_MS);
  switch (rule.activity) {
    case "opened":
      return { lastOpenedAt: { $gte: since } };
    case "clicked":
      return { lastClickedAt: { $gte: since } };
    // $not also matches contacts where the timestamp is missing or null (never opened / clicked).
    case "not_opened":
      return { lastOpenedAt: { $not: { $gte: since } } };
    case "not_clicked":
      return { lastClickedAt: { $not: { $gte: since } } };
    default:
      return nobody();
  }
}

// --- Builder ------------------------------------------------------------------

/** MongoDB filter on `contacts` for one rule. Anything invalid or unresolvable matches nobody. */
export function ruleFilter(rule: SegmentRule, ctx: RuleContext): Filter<ContactDoc> {
  switch (rule?.type) {
    case "list": {
      if (!rule.listId) return nobody();
      if (ctx.existingListIds && !ctx.existingListIds.has(rule.listId)) return nobody(); // deleted list
      if (rule.op === "in") return { listIds: rule.listId };
      if (rule.op === "not_in") return { listIds: { $ne: rule.listId } };
      return nobody();
    }
    case "tag": {
      const tag = (rule.tag ?? "").trim().toLowerCase();
      if (!tag) return nobody();
      if (rule.op === "has") return { tags: tag };
      if (rule.op === "not_has") return { tags: { $ne: tag } };
      return nobody();
    }
    case "field":
      return fieldRuleFilter(rule);
    case "created":
      return createdRuleFilter(rule, ctx.now);
    case "activity":
      return activityRuleFilter(rule, ctx);
    default:
      return nobody();
  }
}

/**
 * MongoDB filter on `contacts` for a set of rules: "all" -> $and, "any" -> $or.
 * No rules = nobody (an empty segment must never mean "everyone").
 * The result has no `status` condition - callers add that.
 */
export function rulesFilter(match: SegmentMatch, rules: readonly SegmentRule[], ctx: RuleContext): Filter<ContactDoc> {
  if (!Array.isArray(rules) || rules.length === 0) return nobody();
  const clauses = rules.map((rule) => ruleFilter(rule, ctx));
  return match === "any" ? { $or: clauses } : { $and: clauses };
}

/** What a set of rules needs looked up before it can be turned into a filter. */
export function ruleReferences(rules: readonly SegmentRule[]): {
  listIds: string[];
  campaignIds: string[];
  campaignActivities: { campaignId: string; activity: Activity }[];
} {
  const listIds = new Set<string>();
  const campaignIds = new Set<string>();
  const activities = new Map<string, { campaignId: string; activity: Activity }>();
  for (const rule of rules ?? []) {
    if (rule?.type === "list" && rule.listId) listIds.add(rule.listId);
    if (rule?.type === "activity" && rule.scope === "campaign" && rule.campaignId) {
      campaignIds.add(rule.campaignId);
      activities.set(campaignActivityKey(rule.campaignId, rule.activity), {
        campaignId: rule.campaignId,
        activity: rule.activity,
      });
    }
  }
  return { listIds: [...listIds], campaignIds: [...campaignIds], campaignActivities: [...activities.values()] };
}

// --- Validation -----------------------------------------------------------------

const listRule = z.object({
  type: z.literal("list"),
  op: z.enum(["in", "not_in"], "Choose “is on” or “is not on”."),
  listId: z.string("Pick a list.").trim().min(1, "Pick a list."),
});

const tagRule = z.object({
  type: z.literal("tag"),
  op: z.enum(["has", "not_has"], "Choose “has” or “doesn't have”."),
  tag: z
    .string("Pick a tag.")
    .trim()
    .toLowerCase()
    .min(1, "Pick a tag.")
    .max(100, "Keep the tag under 100 characters."),
});

const fieldRule = z
  .object({
    type: z.literal("field"),
    field: z
      .string("Pick a field.")
      .trim()
      .min(1, "Pick a field.")
      .refine((key) => fieldPath(key) !== null, "Field names can only contain letters, numbers and underscores (max 50)."),
    op: z.enum(["equals", "not_equals", "contains", "starts_with", "exists", "not_exists"], "Choose how to compare the field."),
    value: z.string().trim().max(200, "Keep the text under 200 characters.").optional(),
  })
  .refine((rule) => rule.op === "exists" || rule.op === "not_exists" || Boolean(rule.value), {
    path: ["value"],
    message: "Type the text to look for.",
  });

const createdRule = z
  .object({
    type: z.literal("created"),
    op: z.enum(["in_last_days", "before", "after"], "Choose “in the last”, “before” or “after”."),
    value: z.union([z.string(), z.number()], "Enter a value.").transform((v) => String(v).trim()),
  })
  .superRefine((rule, ctx) => {
    if (rule.op === "in_last_days") {
      const problem = daysError(rule.value);
      if (problem) ctx.addIssue({ code: "custom", path: ["value"], message: problem });
    } else if (!parseRuleDate(rule.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Pick a date." });
    }
  });

const activityRule = z
  .object({
    type: z.literal("activity"),
    activity: z.enum(["opened", "clicked", "not_opened", "not_clicked"], "Choose what the contact did."),
    scope: z.enum(["last_days", "campaign"], "Choose “any email” or “a specific campaign”."),
    days: z.unknown().optional(),
    campaignId: z.unknown().optional(),
  })
  .superRefine((rule, ctx) => {
    if (rule.scope === "last_days") {
      const problem = daysError(rule.days);
      if (problem) ctx.addIssue({ code: "custom", path: ["days"], message: problem });
    } else if (typeof rule.campaignId !== "string" || !rule.campaignId.trim()) {
      ctx.addIssue({ code: "custom", path: ["campaignId"], message: "Pick a campaign." });
    }
  });

/** Drop everything a rule doesn't use, so what is stored is exactly a SegmentRule. */
function cleanRule(rule: z.output<typeof ruleUnion>): SegmentRule {
  switch (rule.type) {
    case "list":
    case "tag":
      return rule;
    case "field":
      return rule.op === "exists" || rule.op === "not_exists"
        ? { type: "field", field: rule.field, op: rule.op }
        : { type: "field", field: rule.field, op: rule.op, value: rule.value ?? "" };
    case "created":
      return {
        type: "created",
        op: rule.op,
        value: rule.op === "in_last_days" ? String(Number(rule.value)) : rule.value,
      };
    case "activity":
      return rule.scope === "last_days"
        ? { type: "activity", activity: rule.activity, scope: "last_days", days: Number(rule.days) }
        : { type: "activity", activity: rule.activity, scope: "campaign", campaignId: String(rule.campaignId).trim() };
  }
}

const ruleUnion = z.discriminatedUnion("type", [listRule, tagRule, fieldRule, createdRule, activityRule], {
  error: "Choose what this rule is about.",
});

export const segmentRuleSchema = ruleUnion.transform(cleanRule);

export const segmentRulesSchema = z.object({
  match: z.enum(["all", "any"], "Choose whether contacts must match all rules or any rule."),
  rules: z
    .array(segmentRuleSchema, "Add at least one rule.")
    .min(1, "Add at least one rule.")
    .max(MAX_RULES, `A segment can have at most ${MAX_RULES} rules.`),
});

export const segmentInputSchema = segmentRulesSchema.extend({
  name: z.string("Give the segment a name.").trim().min(1, "Give the segment a name.").max(120, "Keep the name under 120 characters."),
  description: z
    .string()
    .trim()
    .max(500, "Keep the description under 500 characters.")
    .transform((v) => v || null),
});

export type SegmentInput = z.output<typeof segmentInputSchema>;

export interface SegmentErrors {
  name?: string;
  description?: string;
  match?: string;
  /** Problem with the rule list as a whole (none, too many). */
  rules?: string;
  /** First problem of each rule, by its position in the list. */
  ruleErrors?: Record<number, string>;
}

/** Sort zod issues into per-field and per-rule messages for the form. */
export function segmentErrors(error: z.ZodError): SegmentErrors {
  const out: SegmentErrors = {};
  for (const issue of error.issues) {
    const [head, index] = issue.path;
    if (head === "rules" && typeof index === "number") {
      out.ruleErrors ??= {};
      out.ruleErrors[index] ??= issue.message;
    } else if (head === "rules" || head === "name" || head === "description" || head === "match") {
      out[head] ??= issue.message;
    } else {
      out.rules ??= issue.message;
    }
  }
  return out;
}
