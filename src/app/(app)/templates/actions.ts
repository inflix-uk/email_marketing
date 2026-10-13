"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { collections } from "@/db";
import { newId, type TemplateDoc } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { parseDesign, renderDesign, serializeDesign } from "@/lib/email-design";
import { findStarter } from "@/lib/templates/starters";

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
  .refine((value) => value.trim().length > 0, "The email HTML can't be empty.")
  .refine((value) => value.length <= MAX_HTML_CHARS, "The HTML is too large (max 500 KB).")
  // Form posts turn line breaks into CRLF; store what the editor shows (LF),
  // so the saved HTML compares equal to the editor content afterwards.
  .transform((value) => value.replace(/\r\n?/g, "\n"));

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function templatePaths(id?: string) {
  revalidatePath("/templates");
  if (id) revalidatePath(`/templates/${id}`);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateTemplateState {
  error?: string;
  fieldErrors?: { name?: string[]; starter?: string[] };
}

const createSchema = z.object({
  name: nameSchema,
  starter: z.string().refine((key) => findStarter(key) !== undefined, "Choose a starting point."),
});

export async function createTemplate(_prev: CreateTemplateState, formData: FormData): Promise<CreateTemplateState> {
  await requireSession();
  const parsed = createSchema.safeParse({ name: text(formData, "name"), starter: text(formData, "starter") });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const starter = findStarter(parsed.data.starter)!;
  const now = new Date();
  const created: TemplateDoc = {
    _id: newId(),
    name: parsed.data.name,
    subject: starter.subject || null,
    previewText: starter.previewText || null,
    html: starter.html,
    // Starter designs open in the visual editor; "Blank (HTML)" has no design.
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
  previewText: optionalText(MAX_PREVIEW_TEXT, "Preview text"),
  html: htmlSchema,
  /** Design JSON from the visual editor; "" when the HTML was written by hand. */
  design: z.string().max(MAX_DESIGN_CHARS, "The design is too large."),
});

export async function saveTemplate(_prev: SaveTemplateState, formData: FormData): Promise<SaveTemplateState> {
  await requireSession();
  const parsed = saveSchema.safeParse({
    id: text(formData, "id"),
    name: text(formData, "name"),
    subject: text(formData, "subject"),
    previewText: text(formData, "previewText"),
    html: text(formData, "html"),
    design: text(formData, "design"),
  });
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const { id, ...values } = parsed.data;
  let html = values.html;
  let design: string | null = null;
  if (values.design.trim()) {
    // Visual mode: the design is the source of truth. Store it in canonical
    // form and regenerate the HTML from it, so the two can never drift apart.
    const parsedDesign = parseDesign(values.design);
    if (!parsedDesign) {
      return {
        error: "The visual design couldn't be read, so nothing was saved. Reload the page and try again.",
        fieldErrors: { design: ["The visual design is not valid."] },
      };
    }
    design = serializeDesign(parsedDesign);
    html = renderDesign(parsedDesign);
    if (html.length > MAX_HTML_CHARS) {
      return { error: "This email is too large (max 500 KB). Remove some blocks and try again." };
    }
  }

  const { templates } = await collections();
  const result = await templates.updateOne(
    { _id: id },
    { $set: { ...values, html, design, updatedAt: new Date() } },
  );
  if (result.matchedCount === 0) {
    return { error: "This template no longer exists - it may have been deleted." };
  }

  templatePaths(id);
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
