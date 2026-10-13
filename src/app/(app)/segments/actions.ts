"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createSegment, deleteSegment, updateSegment } from "@/lib/segments/mutations";
import { previewRules, type SegmentPreview } from "@/lib/segments/queries";
import { segmentErrors, segmentInputSchema, segmentRulesSchema, type SegmentErrors } from "@/lib/segments/rules";

export interface SegmentFormState {
  ok?: boolean;
  error?: string;
  errors?: SegmentErrors;
}

export type PreviewResult = { ok: true; preview: SegmentPreview } | { ok: false; errors: SegmentErrors };

/** The form sends its rules as one JSON field (they are built in the browser). */
function segmentFormValues(formData: FormData) {
  let rules: unknown = [];
  try {
    rules = JSON.parse(String(formData.get("rules") ?? "[]"));
  } catch {
    rules = null; // fails validation with "Add at least one rule."
  }
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    match: String(formData.get("match") ?? ""),
    rules,
  };
}

function invalid(errors: SegmentErrors): SegmentFormState {
  const onlyRules = errors.ruleErrors && !errors.name && !errors.description && !errors.match && !errors.rules;
  return {
    error: onlyRules ? "Some rules aren't finished yet - check the highlighted ones." : "Please fix the highlighted fields.",
    errors,
  };
}

function revalidateSegments(id?: string) {
  revalidatePath("/segments");
  if (id) revalidatePath(`/segments/${id}`);
  // Campaign audience pickers list segments with their counts.
  revalidatePath("/campaigns", "layout");
}

/** Live preview: who matches these (unsaved) rules right now. Reads only. */
export async function previewSegmentAction(match: unknown, rules: unknown): Promise<PreviewResult> {
  await requireSession();
  const parsed = segmentRulesSchema.safeParse({ match, rules });
  if (!parsed.success) return { ok: false, errors: segmentErrors(parsed.error) };
  return { ok: true, preview: await previewRules(parsed.data.match, parsed.data.rules) };
}

export async function createSegmentAction(_prev: SegmentFormState, formData: FormData): Promise<SegmentFormState> {
  await requireSession();
  const parsed = segmentInputSchema.safeParse(segmentFormValues(formData));
  if (!parsed.success) return invalid(segmentErrors(parsed.error));

  const id = await createSegment(parsed.data);
  revalidateSegments();
  redirect(`/segments/${id}?created=1`);
}

export async function updateSegmentAction(id: string, _prev: SegmentFormState, formData: FormData): Promise<SegmentFormState> {
  await requireSession();
  const parsed = segmentInputSchema.safeParse(segmentFormValues(formData));
  if (!parsed.success) return invalid(segmentErrors(parsed.error));

  if (!(await updateSegment(id, parsed.data))) return { error: "This segment no longer exists - it may have been deleted." };
  revalidateSegments(id);
  return { ok: true };
}

export async function deleteSegmentAction(id: string): Promise<void> {
  await requireSession();
  await deleteSegment(id);
  revalidateSegments();
  redirect("/segments");
}
