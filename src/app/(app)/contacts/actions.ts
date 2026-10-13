"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import {
  createContact,
  deleteContact,
  resubscribeContact,
  unsubscribeContact,
  updateContact,
  type SaveContactResult,
} from "@/lib/contacts/mutations";
import { contactFormValues, contactInputSchema, firstErrors, type ContactFieldErrors } from "@/lib/contacts/validation";

export interface ContactFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: ContactFieldErrors;
  /** Set when the email belongs to another contact: link to it. */
  conflictId?: string;
}

function revalidateContacts(id?: string) {
  revalidatePath("/contacts");
  revalidatePath("/lists", "layout");
  if (id) revalidatePath(`/contacts/${id}`);
}

function failure(result: Exclude<SaveContactResult, { ok: true }>): ContactFormState {
  if ("conflictId" in result) {
    return {
      error: "A contact with this email address already exists.",
      fieldErrors: { email: "This email address is already in use." },
      conflictId: result.conflictId,
    };
  }
  return { error: "This contact no longer exists - it may have been deleted." };
}

export async function createContactAction(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  await requireSession();
  const parsed = contactInputSchema.safeParse(contactFormValues(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: firstErrors(parsed.error) };
  }

  const result = await createContact(parsed.data);
  if (!result.ok) return failure(result);

  revalidateContacts();
  redirect(`/contacts/${result.id}?created=1`);
}

export async function updateContactAction(
  id: string,
  _prev: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  await requireSession();
  const parsed = contactInputSchema.safeParse(contactFormValues(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: firstErrors(parsed.error) };
  }

  const result = await updateContact(id, parsed.data);
  if (!result.ok) return failure(result);

  revalidateContacts(id);
  return { ok: true };
}

export interface SubscriptionState {
  error?: string;
  message?: string;
}

export async function unsubscribeContactAction(id: string): Promise<SubscriptionState> {
  await requireSession();
  const changed = await unsubscribeContact(id);
  revalidateContacts(id);
  return changed ? { message: "Contact unsubscribed. They won't receive any more campaigns." } : { error: "This contact is not subscribed." };
}

export async function resubscribeContactAction(
  id: string,
  _prev: SubscriptionState,
  formData: FormData,
): Promise<SubscriptionState> {
  await requireSession();
  if (formData.get("consent") !== "on") {
    return { error: "Please confirm that you have this person's consent before re-subscribing them." };
  }
  const changed = await resubscribeContact(id);
  revalidateContacts(id);
  return changed ? { message: "Contact re-subscribed." } : { error: "This contact is already subscribed." };
}

export async function deleteContactAction(id: string): Promise<void> {
  await requireSession();
  await deleteContact(id);
  revalidateContacts();
  redirect("/contacts");
}
