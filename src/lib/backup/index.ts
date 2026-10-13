import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BSON, type Db, type Document, type IndexDescription } from "mongodb";

// Database backup / restore used by scripts/backup.ts and scripts/restore.ts.
//
// A backup is a folder with one <collection>.jsonl file per collection (one
// document per line, canonical Extended JSON so dates, numbers and binary data
// keep their exact types) plus backup.json describing it (source database,
// counts, indexes). Documents are streamed, never loaded all at once, so it
// works for large collections and for GridFS uploads (uploads.files/.chunks).

const { EJSON } = BSON;

/** Short-lived counters - nothing worth keeping. */
export const SKIPPED_COLLECTIONS = ["rateLimits"];
export const MANIFEST_FILE = "backup.json";

const BATCH_DOCS = 1000;
/** GridFS chunks are ~255 KB each: also cap a batch by size, not just by count. */
const BATCH_BYTES = 8 * 1024 * 1024;

export interface BackupCollection {
  name: string;
  file: string;
  count: number;
  /** Index definitions other than _id, recreated on restore. */
  indexes: IndexDescription[];
}

export interface BackupManifest {
  version: 1;
  /** Database the backup was taken from. */
  database: string;
  createdAt: string;
  collections: BackupCollection[];
}

// --- Pure helpers (unit-tested) ------------------------------------------------

/** Folder name for a backup taken at `date` (UTC), e.g. 2026-10-13_09-30-05. Sorts by time. */
export function backupFolderName(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
}

export function shouldBackUp(collection: string): boolean {
  return !collection.startsWith("system.") && !SKIPPED_COLLECTIONS.includes(collection);
}

export function fileForCollection(collection: string): string {
  return encodeURIComponent(collection) + ".jsonl";
}

/** Inverse of fileForCollection; null for files that are not collection dumps. */
export function collectionForFile(file: string): string | null {
  if (!file.endsWith(".jsonl")) return null;
  try {
    return decodeURIComponent(file.slice(0, -".jsonl".length)) || null;
  } catch {
    return null;
  }
}

/** Host part of a connection string for display - never the username or password. */
export function hostsFromUri(uri: string): string {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri);
  return match?.[1] ?? "unknown host";
}

export interface RestoreArgs {
  folder: string | null;
  drop: boolean;
  yes: boolean;
  unknown: string[];
}

/** `restore.ts <folder> [--drop] [--yes]` */
export function parseRestoreArgs(argv: string[]): RestoreArgs {
  const args: RestoreArgs = { folder: null, drop: false, yes: false, unknown: [] };
  for (const arg of argv) {
    if (arg === "--drop") args.drop = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg.startsWith("-")) args.unknown.push(arg);
    else if (args.folder === null) args.folder = arg;
    else args.unknown.push(arg);
  }
  return args;
}

/** Index definition as createIndexes() wants it (without the fields the server adds). */
export function cleanIndex(index: Document): IndexDescription {
  const rest: Document = { ...index };
  delete rest.v;
  delete rest.ns;
  delete rest.background;
  return rest as IndexDescription;
}

// --- Backup ----------------------------------------------------------------------

/**
 * Write every collection of `db` to `dir`. Calls `onCollection` after each one.
 * Returns the manifest that was written.
 */
export async function backupDatabase(
  db: Db,
  dir: string,
  onCollection?: (done: BackupCollection) => void,
): Promise<BackupManifest> {
  await mkdir(dir, { recursive: true });
  const infos = await db.listCollections({}, { nameOnly: false }).toArray();
  const names = infos
    .filter((c) => c.type !== "view" && shouldBackUp(c.name))
    .map((c) => c.name)
    .sort();

  const manifest: BackupManifest = {
    version: 1,
    database: db.databaseName,
    createdAt: new Date().toISOString(),
    collections: [],
  };

  for (const name of names) {
    const collection = db.collection(name);
    const file = fileForCollection(name);
    let count = 0;
    // promoteValues: false keeps BSON number types (int / long / double) as they are stored.
    const cursor = collection.find({}, { promoteValues: false, batchSize: 500 }).sort({ _id: 1 });
    async function* lines() {
      for await (const doc of cursor) {
        count++;
        yield EJSON.stringify(doc, { relaxed: false }) + "\n";
      }
    }
    await pipeline(Readable.from(lines()), createWriteStream(path.join(dir, file), { encoding: "utf8" }));

    const indexes = (await collection.indexes()).filter((i) => i.name !== "_id_").map(cleanIndex);
    const entry: BackupCollection = { name, file, count, indexes };
    manifest.collections.push(entry);
    onCollection?.(entry);
  }

  await writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

// --- Restore ---------------------------------------------------------------------

/**
 * Read backup.json. A folder that only has .jsonl files (e.g. the manifest was
 * lost) still works: counts and indexes are then unknown.
 */
export async function readBackup(dir: string): Promise<{ manifest: BackupManifest; hasManifest: boolean }> {
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, MANIFEST_FILE), "utf8")) as BackupManifest;
    if (manifest.version !== 1 || !Array.isArray(manifest.collections)) {
      throw new Error(`${MANIFEST_FILE} in ${dir} is not a backup this version understands.`);
    }
    return { manifest, hasManifest: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const files = (await readdir(dir)).sort();
  const collections: BackupCollection[] = [];
  for (const file of files) {
    const name = collectionForFile(file);
    if (name && shouldBackUp(name)) collections.push({ name, file, count: -1, indexes: [] });
  }
  if (!collections.length) throw new Error(`No backup found in ${dir} (no ${MANIFEST_FILE} and no .jsonl files).`);
  return { manifest: { version: 1, database: "", createdAt: "", collections }, hasManifest: false };
}

/** How many documents each collection of the backup currently holds in `db`. */
export async function targetCounts(db: Db, manifest: BackupManifest): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const { name } of manifest.collections) counts.set(name, await db.collection(name).countDocuments({}));
  return counts;
}

export class RestoreRefusedError extends Error {
  constructor(public readonly nonEmpty: string[]) {
    super(`These collections already contain data: ${nonEmpty.join(", ")}. Use --drop to replace them.`);
  }
}

export interface RestoredCollection {
  name: string;
  /** Documents inserted. */
  count: number;
  /** Documents the backup said it had (-1 = unknown). */
  expected: number;
  indexWarnings: string[];
}

/**
 * Load a backup folder into `db`. Collections that already hold documents are
 * only replaced when `drop` is set - otherwise nothing at all is changed and
 * RestoreRefusedError is thrown. Collections that are not in the backup are
 * left alone.
 */
export async function restoreDatabase(
  db: Db,
  dir: string,
  opts: { drop: boolean },
  onCollection?: (done: RestoredCollection) => void,
): Promise<RestoredCollection[]> {
  const { manifest } = await readBackup(dir);

  const existing = await targetCounts(db, manifest);
  const nonEmpty = manifest.collections.map((c) => c.name).filter((name) => (existing.get(name) ?? 0) > 0);
  if (nonEmpty.length && !opts.drop) throw new RestoreRefusedError(nonEmpty);

  const results: RestoredCollection[] = [];
  for (const entry of manifest.collections) {
    const collection = db.collection(entry.name);
    if (opts.drop) await collection.drop().catch(() => false); // "namespace not found" is fine
    await db.createCollection(entry.name).catch(() => null); // already there is fine

    let count = 0;
    let batch: Document[] = [];
    let batchBytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      await collection.insertMany(batch, { ordered: true });
      count += batch.length;
      batch = [];
      batchBytes = 0;
    };

    const reader = createInterface({
      input: createReadStream(path.join(dir, entry.file), { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    let lineNumber = 0;
    for await (const line of reader) {
      lineNumber++;
      if (!line.trim()) continue;
      try {
        batch.push(EJSON.parse(line, { relaxed: false }) as Document);
      } catch (err) {
        throw new Error(`${entry.file} line ${lineNumber} is not valid: ${err instanceof Error ? err.message : err}`);
      }
      batchBytes += line.length;
      if (batch.length >= BATCH_DOCS || batchBytes >= BATCH_BYTES) await flush();
    }
    await flush();

    const indexWarnings: string[] = [];
    for (const index of entry.indexes) {
      try {
        await collection.createIndexes([index]);
      } catch (err) {
        indexWarnings.push(`index ${index.name ?? JSON.stringify(index.key)}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const done: RestoredCollection = { name: entry.name, count, expected: entry.count, indexWarnings };
    results.push(done);
    onCollection?.(done);
  }
  return results;
}
