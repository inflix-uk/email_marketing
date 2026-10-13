"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { addEmailsToList, createList, deleteList, removeListMember, updateList, type AddEmailsResult } from "@/lib/contacts/mutations";
import { getList } from "@/lib/contacts/queries";
import { firstErrors, listInputSchema, parseEmailList } from "@/lib/contacts/validation";

export interface ListFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"name" | "description", string>>;
  /** Echoed back on errors so the form keeps what was typed. */
  values?: { name: string; description: string };
}

function listFormValues(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
  };
}

function revalidateLists(id?: string) {
  revalidatePath("/lists");
  if (id) revalidatePath(`/lists/${id}`);
  revalidatePath("/contacts", "layout");
}

export async function createListAction(_prev: ListFormState, formData: FormData): Promise<ListFormState> {
  await requireSession();
  const values = listFormValues(formData);
  const parsed = listInputSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: firstErrors(parsed.error), values };

  const id = await createList(parsed.data);
  revalidateLists();
  redirect(`/lists/${id}`);
}

export async function updateListAction(id: string, _prev: ListFormState, formData: FormData): Promise<ListFormState> {
  await requireSession();
  const values = listFormValues(formData);
  const parsed = listInputSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: firstErrors(parsed.error), values };

  if (!(await updateList(id, parsed.data))) return { error: "This list no longer exists.", values };
  revalidateLists(id);
  return { ok: true };
}

export async function deleteListAction(id: string): Promise<void> {
  await requireSession();
  await deleteList(id);
  revalidateLists();
  redirect("/lists");
}

export async function removeMemberAction(listId: string, contactId: string): Promise<void> {
  await requireSession();
  await removeListMember(listId, contactId);
  revalidateLists(listId);
}

/** Paste-to-add is for quick additions; larger batches belong in the CSV importer. */
const MAX_PASTED_EMAILS = 5000;

export interface AddEmailsState {
  error?: string;
  result?: AddEmailsResult;
  /** Entries that weren't valid addresses (first few). */
  invalid?: string[];
  invalidCount?: number;
  /** Echoed back on errors so the textarea keeps its content. */
  text?: string;
}

export async function addEmailsAction(listId: string, _prev: AddEmailsState, formData: FormData): Promise<AddEmailsState> {
  await requireSession();
  const text = String(formData.get("emails") ?? "");
  const { emails, invalid } = parseEmailList(text);

  if (emails.length === 0) {
    return {
      error: invalid.length
        ? "None of those look like email addresses. Put one address per line, or separate them with commas."
        : "Paste at least one email address.",
      invalid: invalid.slice(0, 20),
      invalidCount: invalid.length,
      text,
    };
  }
  if (emails.length > MAX_PASTED_EMAILS) {
    return {
      error: `That's ${emails.length.toLocaleString("en-GB")} addresses - paste at most ${MAX_PASTED_EMAILS.toLocaleString("en-GB")} at a time, or use a CSV import.`,
      text,
    };
  }
  if (!(await getList(listId))) return { error: "This list no longer exists.", text };

  const result = await addEmailsToList(listId, emails);
  revalidateLists(listId);
  return { result, invalid: invalid.slice(0, 20), invalidCount: invalid.length };
}
