"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { BulkError, MAX_BULK_IDS, runBulkAction, type BulkResult } from "@/lib/contacts/bulk";
import { cleanContactFilters } from "@/lib/contacts/filters";
import {
  createContact,
  deleteContact,
  resubscribeContact,
  unsubscribeContact,
  updateContact,
  type SaveContactResult,
} from "@/lib/contacts/mutations";
import { getContact, getList } from "@/lib/contacts/queries";
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

  // The form only edits email, names and lists. Tags and extra fields are no
  // longer on it, so keep whatever the contact already has instead of wiping them.
  const current = await getContact(id);
  if (!current) return failure({ ok: false, notFound: true });
  const result = await updateContact(id, { ...parsed.data, fields: current.fields ?? {}, tags: current.tags ?? [] });
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
  return changed ? { message: "Unsubscribed." } : { error: "This contact is not subscribed." };
}

/**
 * Re-subscribe, or confirm a pending contact. Needs `consent=on`, which the
 * page only sends from the "Yes, subscribe" confirmation step.
 */
export async function resubscribeContactAction(
  id: string,
  _prev: SubscriptionState,
  formData: FormData,
): Promise<SubscriptionState> {
  await requireSession();
  if (formData.get("consent") !== "on") {
    return { error: "Please confirm that you have this person's consent before subscribing them." };
  }
  const previous = await resubscribeContact(id);
  revalidateContacts(id);
  if (!previous) return { error: "This contact is already subscribed." };
  return { message: "Subscribed." };
}

export async function deleteContactAction(id: string): Promise<void> {
  await requireSession();
  await deleteContact(id);
  revalidateContacts();
  redirect("/contacts");
}

// --- Bulk actions -------------------------------------------------------------------

const bulkSchema = z.object({
  target: z.union([
    z.object({
      ids: z
        .array(z.string().min(1))
        .min(1, "Select at least one contact.")
        .max(MAX_BULK_IDS, `Select at most ${MAX_BULK_IDS} contacts at a time.`),
    }),
    // The contacts page only filters by search and list.
    z.object({
      filters: z.object({
        q: z.string().optional(),
        listId: z.string().optional(),
      }),
    }),
  ]),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_to_list"), listId: z.string().min(1, "Choose a list.") }),
    z.object({ type: z.literal("remove_from_list"), listId: z.string().min(1, "Choose a list.") }),
    // The page only sends this from the "only people who agreed" confirmation step.
    z.object({ type: z.literal("subscribe"), consent: z.literal(true, "Confirm these people agreed to get your emails.") }),
    z.object({ type: z.literal("unsubscribe") }),
    z.object({ type: z.literal("delete") }),
  ]),
});

export type BulkActionInput = z.input<typeof bulkSchema>;
type ContactBulkAction = z.output<typeof bulkSchema>["action"];

export interface BulkState {
  error?: string;
  message?: string;
}

function people(n: number): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? "contact" : "contacts"}`;
}

async function bulkMessage(action: ContactBulkAction, { matched, changed }: BulkResult): Promise<string> {
  const rest = matched - changed;
  const others = (text: string) => (rest > 0 ? ` ${rest.toLocaleString("en-GB")} ${text}.` : "");
  switch (action.type) {
    case "add_to_list": {
      const name = (await getList(action.listId))?.name ?? "the list";
      return `Added ${people(changed)} to ${name}.${others(rest === 1 ? "was already on it" : "were already on it")}`;
    }
    case "remove_from_list": {
      const name = (await getList(action.listId))?.name ?? "the list";
      return `Removed ${people(changed)} from ${name}.${others(rest === 1 ? "wasn't on it" : "weren't on it")}`;
    }
    case "subscribe":
      return `Subscribed ${people(changed)}.${others(rest === 1 ? "was already subscribed or can't get email (bounced)" : "were already subscribed or can't get email (bounced)")}`;
    case "unsubscribe":
      return `Unsubscribed ${people(changed)}.${others(rest === 1 ? "wasn't subscribed" : "weren't subscribed")}`;
    case "delete":
      return `Deleted ${people(changed)}.`;
  }
}

/**
 * Apply one action to the ticked contacts (`ids`) or to everyone matching the
 * current filter (`filters`). Only re-subscribes on the explicit, confirmed "subscribe" action; never triggers
 * automations.
 */
export async function bulkContactsAction(input: BulkActionInput): Promise<BulkState> {
  await requireSession();
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "That action isn't valid." };
  const { action } = parsed.data;
  const target = "ids" in parsed.data.target ? parsed.data.target : { filters: cleanContactFilters(parsed.data.target.filters) };

  try {
    const result = await runBulkAction(target, action);
    return { message: await bulkMessage(action, result) };
  } catch (err) {
    if (err instanceof BulkError) return { error: err.message };
    console.error("[contacts bulk] failed", err);
    return { error: "Something went wrong part-way through. Check the list and run the action again - it is safe to repeat." };
  } finally {
    revalidatePath("/contacts", "layout");
    revalidatePath("/lists", "layout");
  }
}
