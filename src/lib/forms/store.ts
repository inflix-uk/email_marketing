import { collections } from "@/db";
import { fromDoc, newId, type Form } from "@/db/schema";
import { existingListIds } from "@/lib/contacts/queries";
import type { FormInput } from "./validation";

// Read / write the `forms` collection (admin side).

export async function listForms(): Promise<Form[]> {
  const { forms } = await collections();
  const docs = await forms.find({}, { sort: { createdAt: -1 } }).toArray();
  return docs.map(fromDoc);
}

export async function getForm(id: string): Promise<Form | null> {
  if (!id || id.length > 64) return null;
  const { forms } = await collections();
  const doc = await forms.findOne({ _id: id });
  return doc ? fromDoc(doc) : null;
}

export async function createForm(input: FormInput): Promise<string> {
  const { forms } = await collections();
  const id = newId();
  const now = new Date();
  await forms.insertOne({
    _id: id,
    ...input,
    listIds: await existingListIds(input.listIds),
    submissions: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Returns false when the form no longer exists. */
export async function updateForm(id: string, input: FormInput): Promise<boolean> {
  const { forms } = await collections();
  const result = await forms.updateOne(
    { _id: id },
    { $set: { ...input, listIds: await existingListIds(input.listIds), updatedAt: new Date() } },
  );
  return result.matchedCount > 0;
}

/** Contacts who signed up through the form are kept. */
export async function deleteForm(id: string): Promise<boolean> {
  const { forms } = await collections();
  return (await forms.deleteOne({ _id: id })).deletedCount > 0;
}
