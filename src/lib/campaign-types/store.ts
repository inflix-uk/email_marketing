// Small database helpers shared by the campaign-type runners.

import { createHash } from "node:crypto";
import type { Collection, OptionalUnlessRequiredId } from "mongodb";
import { isDuplicateKeyError } from "@/db";
import { newId, type SendDoc } from "@/db/schema";

/** A UUID-shaped id derived from a seed: the same seed always gives the same id (idempotent creates). */
export function deterministicId(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function queuedSend(campaignId: string, contactId: string, email: string, now: Date): SendDoc {
  return {
    _id: newId(),
    campaignId,
    kind: "campaign",
    contactId,
    email,
    status: "queued",
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    messageId: null,
    sentAt: null,
    openedAt: null,
    clickedAt: null,
    unsubscribedAt: null,
    openCount: 0,
    clickCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function onlyDuplicateKeyErrors(err: unknown): boolean {
  const e = err as { writeErrors?: unknown; writeConcernError?: unknown };
  if (e?.writeConcernError) return false;
  if (e?.writeErrors !== undefined) {
    const list = Array.isArray(e.writeErrors) ? e.writeErrors : [e.writeErrors];
    return list.length > 0 && list.every((w) => isDuplicateKeyError(w));
  }
  return isDuplicateKeyError(err);
}

/** insertMany (ordered: false) that treats "already there" (unique index) as success. */
export async function insertIgnoringDuplicates<T extends { _id: string }>(collection: Collection<T>, docs: T[]): Promise<void> {
  if (docs.length === 0) return;
  try {
    await collection.insertMany(docs as unknown as OptionalUnlessRequiredId<T>[], { ordered: false });
  } catch (err) {
    if (!onlyDuplicateKeyErrors(err)) throw err;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
