"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { BulkError, MAX_BULK_IDS, runBulkAction, type BulkAction, type BulkResult } from "@/lib/contacts/bulk";
import { cleanContactFilters } from "@/lib/contacts/filters";
import {
  createContact,
  deleteContact,
  resubscribeContact,
  suppressEmails,
  unsubscribeContact,
  updateContact,
  type SaveContactResult,
  type SuppressResult,
} from "@/lib/contacts/mutations";
import { getList } from "@/lib/contacts/queries";
import {
  contactFormValues,
  contactInputSchema,
  firstErrors,
  parseEmailList,
  tagSchema,
  type ContactFieldErrors,
} from "@/lib/contacts/validation";

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

/** Re-subscribe, or confirm a pending contact - both need the consent checkbox. */
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
  return { message: previous === "pending" ? "Subscription confirmed." : "Contact re-subscribed." };
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
        .max(MAX_BULK_IDS, `Select at most ${MAX_BULK_IDS} contacts at a time, or use "Select all matching".`),
    }),
    z.object({
      filters: z.object({
        q: z.string().optional(),
        status: z.string().optional(),
        listId: z.string().optional(),
        tag: z.string().optional(),
      }),
    }),
  ]),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_to_list"), listId: z.string().min(1, "Choose a list.") }),
    z.object({ type: z.literal("remove_from_list"), listId: z.string().min(1, "Choose a list.") }),
    z.object({ type: z.literal("add_tag"), tag: tagSchema }),
    z.object({ type: z.literal("remove_tag"), tag: tagSchema }),
    z.object({ type: z.literal("unsubscribe") }),
    z.object({ type: z.literal("delete") }),
  ]),
});

export type BulkActionInput = z.input<typeof bulkSchema>;

export interface BulkState {
  error?: string;
  message?: string;
}

function people(n: number): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? "contact" : "contacts"}`;
}

async function bulkMessage(action: BulkAction, { matched, changed }: BulkResult): Promise<string> {
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
    case "add_tag":
      return `Tagged ${people(changed)} with "${action.tag}".${others("already had it")}`;
    case "remove_tag":
      return `Removed the tag "${action.tag}" from ${people(changed)}.${others("didn't have it")}`;
    case "unsubscribe":
      return `Unsubscribed ${people(changed)}.${others(rest === 1 ? "wasn't subscribed" : "weren't subscribed")}`;
    case "delete":
      return `Deleted ${people(changed)}.`;
  }
}

/**
 * Apply one action to the ticked contacts (`ids`) or to everyone matching the
 * current filter (`filters`). Never re-subscribes anyone and never triggers
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

// --- Suppression list ---------------------------------------------------------------

/** Paste-to-suppress is for quick lists; it shares the limit of "paste emails into a list". */
const MAX_SUPPRESSED_EMAILS = 5000;

export interface SuppressState {
  error?: string;
  result?: SuppressResult;
  /** Entries that weren't valid addresses (first few). */
  invalid?: string[];
  invalidCount?: number;
  /** Echoed back on errors so the textarea keeps its content. */
  text?: string;
}

export async function suppressEmailsAction(_prev: SuppressState, formData: FormData): Promise<SuppressState> {
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
  if (emails.length > MAX_SUPPRESSED_EMAILS) {
    return {
      error: `That's ${emails.length.toLocaleString("en-GB")} addresses - paste at most ${MAX_SUPPRESSED_EMAILS.toLocaleString("en-GB")} at a time.`,
      text,
    };
  }

  const result = await suppressEmails(emails);
  revalidatePath("/contacts", "layout");
  revalidatePath("/lists", "layout");
  return { result, invalid: invalid.slice(0, 20), invalidCount: invalid.length };
}
