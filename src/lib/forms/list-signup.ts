import { collections } from "@/db";
import { fromDoc, type Form, type List } from "@/db/schema";
import { createForm } from "./store";
import { FORM_DEFAULTS } from "./validation";

// "Website sign-up" on a list's page: one sign-up form per list, so people who
// sign up on the website land straight in that list (e.g. "Newsletter").

/** The list's website sign-up form (the oldest form that adds people to it), if any. */
export async function findListSignupForm(listId: string): Promise<Form | null> {
  const { forms } = await collections();
  const doc = await forms.findOne({ listIds: listId }, { sort: { createdAt: 1 } });
  return doc ? fromDoc(doc) : null;
}

/** The list's sign-up form, created when it has none yet. */
export async function ensureListSignupForm(list: Pick<List, "id" | "name">): Promise<Form> {
  const existing = await findListSignupForm(list.id);
  if (existing) return existing;
  await createForm({
    name: `${list.name} sign-up`.slice(0, 100),
    title: FORM_DEFAULTS.title,
    description: null,
    buttonText: FORM_DEFAULTS.buttonText,
    fields: [{ key: "first_name", label: "First name", required: false }],
    listIds: [list.id],
    tags: [],
    // Sign-ups show up as subscribed straight away, like most website newsletter boxes.
    doubleOptIn: false,
    successMessage: FORM_DEFAULTS.successMessage,
    redirectUrl: null,
    active: true,
  });
  // Re-read: if two clicks raced, both end up showing the same (oldest) form.
  const created = await findListSignupForm(list.id);
  if (!created) throw new Error("Could not create the sign-up form");
  return created;
}

/** Pause or resume sign-ups. Returns false when the form no longer exists. */
export async function setListSignupActive(formId: string, active: boolean): Promise<boolean> {
  const { forms } = await collections();
  const result = await forms.updateOne({ _id: formId }, { $set: { active, updatedAt: new Date() } });
  return result.matchedCount > 0;
}
