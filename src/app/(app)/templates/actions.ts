"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { collections } from "@/db";
import { newId, type TemplateDoc } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { parseDesign, renderDesign, serializeDesign } from "@/lib/email-design";
import { BLANK_STARTER, BLANK_VISUAL_STARTER, findStarter } from "@/lib/templates/starters";

const MAX_NAME = 120;
const MAX_SUBJECT = 200;
const MAX_PREVIEW_TEXT = 200;
const MAX_HTML_CHARS = 500_000;
const MAX_DESIGN_CHARS = 500_000;

const nameSchema = z
  .string()
  .trim()
  .min(1, "Give the template a name.")
  .max(MAX_NAME, `Keep the name under ${MAX_NAME} characters.`);

/** Trimmed; empty becomes null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((value) => value || null);

const htmlSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "The email can't be empty.")
  .refine((value) => value.length <= MAX_HTML_CHARS, "This email is too large. Remove some content and try again.")
  // Form posts turn line breaks into CRLF; store what the editor shows (LF),
  // so the saved HTML compares equal to the editor content afterwards.
  .transform((value) => value.replace(/\r\n?/g, "\n"));

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** The field's value, or undefined when the form doesn't have it at all (= leave it unchanged). */
function optionalField(formData: FormData, key: string): string | undefined {
  return formData.has(key) ? text(formData, key) : undefined;
}

function templatePaths(id?: string) {
  revalidatePath("/templates");
  if (id) revalidatePath(`/templates/${id}`);
}

// ---------------------------------------------------------------------------
// Create (one click on a starter card on /templates/new)
// ---------------------------------------------------------------------------

export async function createTemplate(formData: FormData): Promise<void> {
  await requireSession();
  const starter = findStarter(text(formData, "starter"));
  if (!starter) redirect("/templates/new");

  const blank = starter.key === BLANK_VISUAL_STARTER.key || starter.key === BLANK_STARTER.key;
  const now = new Date();
  const created: TemplateDoc = {
    _id: newId(),
    name: blank ? "Untitled template" : starter.name,
    subject: starter.subject || null,
    // The template editor has no preview-text field, so new templates don't
    // get the starter's (it couldn't be changed to match the new content).
    previewText: null,
    html: starter.html,
    design: starter.design,
    createdAt: now,
    updatedAt: now,
  };
  const { templates } = await collections();
  await templates.insertOne(created);

  templatePaths();
  redirect(`/templates/${created._id}`);
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export type TemplateField = "name" | "subject" | "previewText" | "html" | "design";

export interface SaveTemplateState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<TemplateField, string[]>>;
}

const saveSchema = z.object({
  id: z.string().min(1),
  name: nameSchema,
  subject: optionalText(MAX_SUBJECT, "The subject"),
  /** Not on the form any more: missing means "keep the stored value". */
  previewText: optionalText(MAX_PREVIEW_TEXT, "Preview text").optional(),
  html: htmlSchema,
  /** Design JSON from the visual editor; "" when the HTML was written by hand. */
  design: z.string().max(MAX_DESIGN_CHARS, "The design is too large."),
});

/**
 * Saves the template. When the form was submitted with the
 * `then=campaign` button, continues to a new campaign using it.
 */
export async function saveTemplate(_prev: SaveTemplateState, formData: FormData): Promise<SaveTemplateState> {
  await requireSession();
  const parsed = saveSchema.safeParse({
    id: text(formData, "id"),
    name: text(formData, "name"),
    subject: text(formData, "subject"),
    previewText: optionalField(formData, "previewText"),
    html: text(formData, "html"),
    design: text(formData, "design"),
  });
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    return { error: Object.values(fieldErrors).flat()[0] ?? "Check the form and try again.", fieldErrors };
  }

  const { id, previewText, ...values } = parsed.data;
  let html = values.html;
  let design: string | null = null;
  if (values.design.trim()) {
    // Visual mode: the design is the source of truth. Store it in canonical
    // form and regenerate the HTML from it, so the two can never drift apart.
    const parsedDesign = parseDesign(values.design);
    if (!parsedDesign) {
      return {
        error: "The design couldn't be read, so nothing was saved. Reload the page and try again.",
        fieldErrors: { design: ["The design is not valid."] },
      };
    }
    design = serializeDesign(parsedDesign);
    html = renderDesign(parsedDesign);
    if (html.length > MAX_HTML_CHARS) {
      return { error: "This email is too large. Remove some blocks and try again." };
    }
  }

  const { templates } = await collections();
  const result = await templates.updateOne(
    { _id: id },
    {
      $set: {
        name: values.name,
        subject: values.subject,
        ...(previewText !== undefined ? { previewText } : {}),
        html,
        design,
        updatedAt: new Date(),
      },
    },
  );
  if (result.matchedCount === 0) {
    return { error: "This template no longer exists - it may have been deleted." };
  }

  templatePaths(id);
  if (text(formData, "then") === "campaign") redirect(`/campaigns/new?template=${encodeURIComponent(id)}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Duplicate / delete (plain form actions)
// ---------------------------------------------------------------------------

export async function duplicateTemplate(formData: FormData): Promise<void> {
  await requireSession();
  const id = text(formData, "id");
  const { templates } = await collections();
  const original = id ? await templates.findOne({ _id: id }) : null;
  if (!original) redirect("/templates");

  const suffix = " (copy)";
  const now = new Date();
  const copy: TemplateDoc = {
    _id: newId(),
    name: original.name.slice(0, MAX_NAME - suffix.length) + suffix,
    subject: original.subject,
    previewText: original.previewText,
    html: original.html,
    design: original.design ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await templates.insertOne(copy);

  templatePaths();
  redirect(`/templates/${copy._id}`);
}

export async function deleteTemplate(formData: FormData): Promise<void> {
  await requireSession();
  const id = text(formData, "id");
  if (id) {
    const { templates, campaigns } = await collections();
    await templates.deleteOne({ _id: id });
    // No foreign keys: unlink campaigns ourselves. They keep their own copy of the HTML.
    await campaigns.updateMany({ templateId: id }, { $set: { templateId: null } });
  }
  templatePaths(id);
  redirect("/templates");
}
