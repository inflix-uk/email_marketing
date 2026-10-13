"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { firstErrors } from "@/lib/contacts/validation";
import { createForm, deleteForm, updateForm } from "@/lib/forms/store";
import { formInputSchema, type FormFieldErrors } from "@/lib/forms/validation";

export interface FormEditorState {
  ok?: boolean;
  error?: string;
  fieldErrors?: FormFieldErrors;
}

/** Read the editor's FormData into the shape `formInputSchema` expects. */
function editorValues(formData: FormData) {
  let fields: unknown = [];
  try {
    fields = JSON.parse(String(formData.get("fields") ?? "[]"));
  } catch {
    fields = null; // fails validation below
  }
  const text = (name: string) => String(formData.get(name) ?? "");
  return {
    name: text("name"),
    title: text("title"),
    description: text("description"),
    buttonText: text("buttonText"),
    fields,
    listIds: formData.getAll("listIds").map(String),
    tags: text("tags"),
    doubleOptIn: formData.get("doubleOptIn") === "on",
    successMessage: text("successMessage"),
    redirectUrl: text("redirectUrl"),
    active: formData.get("active") === "on",
  };
}

function invalid(error: Parameters<typeof firstErrors>[0]): FormEditorState {
  return { error: "Please fix the highlighted fields.", fieldErrors: firstErrors(error) };
}

export async function createFormAction(_prev: FormEditorState, formData: FormData): Promise<FormEditorState> {
  await requireSession();
  const parsed = formInputSchema.safeParse(editorValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  const id = await createForm(parsed.data);
  revalidatePath("/forms");
  redirect(`/forms/${id}`);
}

export async function updateFormAction(id: string, _prev: FormEditorState, formData: FormData): Promise<FormEditorState> {
  await requireSession();
  const parsed = formInputSchema.safeParse(editorValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  if (!(await updateForm(id, parsed.data))) return { error: "This form no longer exists." };
  revalidatePath("/forms");
  revalidatePath(`/forms/${id}`);
  return { ok: true };
}

export async function deleteFormAction(id: string): Promise<void> {
  await requireSession();
  await deleteForm(id);
  revalidatePath("/forms");
  redirect("/forms");
}
