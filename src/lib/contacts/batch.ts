import { MongoBulkWriteError } from "mongodb";
import { isDuplicateKeyError } from "@/db";

/** Write (and look up) at most this many documents per round trip. */
export const WRITE_CHUNK_SIZE = 1000;

export function chunk<T>(items: readonly T[], size = WRITE_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Run `fn` over all items with at most `limit` calls in flight (stops on the first error). */
export async function forEachConcurrent<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

export interface BulkOutcome {
  insertedCount: number;
  modifiedCount: number;
  /** Indexes (into the ops array) of inserts that hit the unique email index. */
  duplicateIndexes: number[];
}

/**
 * Result counts of an unordered bulk write. Duplicate-key failures (an email
 * inserted concurrently by someone else) don't abort the batch: their op
 * indexes are returned so the caller can retry those rows as updates. Any
 * other write error is re-thrown.
 */
export async function bulkOutcome(write: () => Promise<{ insertedCount: number; modifiedCount: number }>): Promise<BulkOutcome> {
  try {
    const result = await write();
    return { insertedCount: result.insertedCount, modifiedCount: result.modifiedCount, duplicateIndexes: [] };
  } catch (err) {
    if (!(err instanceof MongoBulkWriteError)) throw err;
    const writeErrors = Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors];
    if (writeErrors.length === 0 || writeErrors.some((e) => !isDuplicateKeyError(e))) throw err;
    return {
      insertedCount: err.insertedCount,
      modifiedCount: err.modifiedCount,
      duplicateIndexes: writeErrors.map((e) => e.index),
    };
  }
}
