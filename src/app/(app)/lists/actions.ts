"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { addEmailsToList, createList, deleteList, removeListMember, updateList, type AddEmailsResult } from "@/lib/contacts/mutations";
import { getList } from "@/lib/contacts/queries";
import { listInputSchema, parseEmailList } from "@/lib/contacts/validation";

export interface ListFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"name", string>>;
  /** Echoed back on errors so the form keeps what was typed. */
  values?: { name: string };
}

function revalidateLists(id?: string) {
  revalidatePath("/lists");
  if (id) revalidatePath(`/lists/${id}`);
  revalidatePath("/contacts", "layout");
}

/** The list forms only have a name. */
function parseName(formData: FormData) {
  const values = { name: String(formData.get("name") ?? "") };
  const parsed = listInputSchema.shape.name.safeParse(values.name);
  return parsed.success
    ? { ok: true as const, name: parsed.data, values }
    : { ok: false as const, state: { fieldErrors: { name: parsed.error.issues[0].message }, values } };
}

export async function createListAction(_prev: ListFormState, formData: FormData): Promise<ListFormState> {
  await requireSession();
  const input = parseName(formData);
  if (!input.ok) return input.state;

  const id = await createList({ name: input.name, description: null });
  revalidateLists();
  redirect(`/lists/${id}`);
}

/** Rename a list. Its stored description (no longer editable) is kept as it is. */
export async function updateListAction(id: string, _prev: ListFormState, formData: FormData): Promise<ListFormState> {
  await requireSession();
  const input = parseName(formData);
  if (!input.ok) return input.state;

  const current = await getList(id);
  if (!current || !(await updateList(id, { name: input.name, description: current.description ?? null }))) {
    return { error: "This list no longer exists.", values: input.values };
  }
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
      error: invalid.length ? "None of those are email addresses." : "Paste at least one email address.",
      invalid: invalid.slice(0, 20),
      invalidCount: invalid.length,
      text,
    };
  }
  if (emails.length > MAX_PASTED_EMAILS) {
    return {
      error: `That's ${emails.length.toLocaleString("en-GB")} addresses. Paste at most ${MAX_PASTED_EMAILS.toLocaleString("en-GB")} at a time, or import a CSV file.`,
      text,
    };
  }
  if (!(await getList(listId))) return { error: "This list no longer exists.", text };

  const result = await addEmailsToList(listId, emails);
  revalidateLists(listId);
  return { result, invalid: invalid.slice(0, 20), invalidCount: invalid.length };
}
