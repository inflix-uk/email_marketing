import { cache } from "react";
import { collections } from "@/db";
import { fromDoc, type AutomationTrigger } from "@/db/schema";

// Read-side helpers shared by the automation pages and actions.

/** Deduplicated per request, so generateMetadata and the page share one query. */
export const getAutomation = cache(async (id: string) => {
  if (!id || id.length > 64) return undefined;
  const { automations } = await collections();
  const doc = await automations.findOne({ _id: id });
  return doc ? fromDoc(doc) : undefined;
});

export interface TriggerOption {
  id: string;
  name: string;
}

export interface TriggerOptions {
  lists: TriggerOption[];
  forms: TriggerOption[];
}

/** Case-insensitive sort on names. */
const NAME_COLLATION = { locale: "en", strength: 2 } as const;
const MAX_OPTIONS = 500;

/** The lists and sign-up forms an automation can be started by, alphabetically. */
export async function getTriggerOptions(): Promise<TriggerOptions> {
  const { lists, forms } = await collections();
  const [listRows, formRows] = await Promise.all([
    lists.find({}, { projection: { name: 1 } }).collation(NAME_COLLATION).sort({ name: 1 }).limit(MAX_OPTIONS).toArray(),
    forms.find({}, { projection: { name: 1 } }).collation(NAME_COLLATION).sort({ name: 1 }).limit(MAX_OPTIONS).toArray(),
  ]);
  return {
    lists: listRows.map((l) => ({ id: l._id, name: l.name })),
    forms: formRows.map((f) => ({ id: f._id, name: f.name })),
  };
}

/** Names of the lists / forms the given triggers point at (deleted ones are simply missing). */
export async function getTriggerNames(
  triggers: AutomationTrigger[],
): Promise<{ lists: Map<string, string>; forms: Map<string, string> }> {
  const listIds = [...new Set(triggers.flatMap((t) => (t?.type === "list_joined" && t.listId ? [t.listId] : [])))];
  const formIds = [...new Set(triggers.flatMap((t) => (t?.type === "form_submitted" && t.formId ? [t.formId] : [])))];
  const { lists, forms } = await collections();
  const [listRows, formRows] = await Promise.all([
    listIds.length ? lists.find({ _id: { $in: listIds } }, { projection: { name: 1 } }).toArray() : [],
    formIds.length ? forms.find({ _id: { $in: formIds } }, { projection: { name: 1 } }).toArray() : [],
  ]);
  return {
    lists: new Map(listRows.map((l) => [l._id, l.name])),
    forms: new Map(formRows.map((f) => [f._id, f.name])),
  };
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
