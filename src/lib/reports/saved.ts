import { collections } from "@/db";
import { newId } from "@/db/schema";
import { normalizeEmail } from "@/lib/utils";

// Saved /reports views. Each belongs to the person who saved it.

export interface SavedReport {
  id: string;
  name: string;
  query: string;
}

/** users._id for a signed-in email, or null when the account is gone. */
export async function userIdForEmail(email: string): Promise<string | null> {
  const { users } = await collections();
  const user = await users.findOne({ email: normalizeEmail(email) }, { projection: { _id: 1 } });
  return user?._id ?? null;
}

export async function listSavedReports(ownerId: string): Promise<SavedReport[]> {
  const { reports } = await collections();
  const docs = await reports
    .find({ ownerId }, { projection: { name: 1, query: 1 } })
    .collation({ locale: "en", strength: 2 })
    .sort({ name: 1 })
    .limit(100)
    .toArray();
  return docs.map((d) => ({ id: d._id, name: d.name, query: d.query }));
}

/** Save a view; saving again under the same name (any case) replaces it. */
export async function saveReport(ownerId: string, name: string, query: string): Promise<void> {
  const { reports } = await collections();
  const now = new Date();
  await reports.updateOne(
    { ownerId, name },
    { $set: { query, updatedAt: now }, $setOnInsert: { _id: newId(), ownerId, name, createdAt: now } },
    { upsert: true, collation: { locale: "en", strength: 2 } },
  );
}

export async function deleteReport(ownerId: string, id: string): Promise<void> {
  const { reports } = await collections();
  await reports.deleteOne({ _id: id, ownerId });
}
