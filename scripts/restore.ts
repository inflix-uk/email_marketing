// Restore a backup made with `npm run db:backup`:
//   npm run db:restore -- data/backups/2026-10-13_09-30-05            (shows what would happen)
//   npm run db:restore -- data/backups/2026-10-13_09-30-05 --yes      (restores into empty collections)
//   npm run db:restore -- data/backups/2026-10-13_09-30-05 --drop --yes   (replaces existing data)
//
// It always prints the target database first and changes nothing without --yes.
// Collections that already hold data are only replaced with --drop.
import "../src/worker/load-env";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { closeDb, getDb } from "../src/db";
import { hostsFromUri, parseRestoreArgs, readBackup, restoreDatabase, targetCounts } from "../src/lib/backup";
import { getMongoUri } from "../src/lib/config";

const USAGE = "Usage: npm run db:restore -- <backup folder> [--drop] [--yes]";
const BACKUPS_DIR = path.join(process.cwd(), "data", "backups");

const count = (n: number) => new Intl.NumberFormat("en-GB").format(n);
const docs = (n: number) => `${count(n).padStart(10)} ${n === 1 ? "document" : "documents"}`;

function findFolder(arg: string): string | null {
  for (const candidate of [path.resolve(arg), path.join(BACKUPS_DIR, arg)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function listBackups(): string[] {
  try {
    return readdirSync(BACKUPS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function main(): Promise<number> {
  const args = parseRestoreArgs(process.argv.slice(2));
  if (args.unknown.length) {
    console.error(`Unknown option: ${args.unknown.join(" ")}\n${USAGE}`);
    return 1;
  }
  if (!args.folder) {
    console.error(USAGE);
    const backups = listBackups();
    if (backups.length) console.error(`\nBackups in data/backups:\n${backups.map((b) => "  " + b).join("\n")}`);
    return 1;
  }
  const dir = findFolder(args.folder);
  if (!dir) {
    console.error(`Backup folder not found: ${args.folder}`);
    return 1;
  }

  const { manifest, hasManifest } = await readBackup(dir);
  const db = await getDb();
  const existing = await targetCounts(db, manifest);

  console.log(`Backup:  ${dir}`);
  if (hasManifest) console.log(`         taken ${manifest.createdAt} from database "${manifest.database}"`);
  else console.log("         (no backup.json - document counts and indexes are unknown)");
  console.log(`Target:  database "${db.databaseName}" on ${hostsFromUri(getMongoUri() ?? "")}\n`);
  if (hasManifest && manifest.database !== db.databaseName) {
    console.log(`NOTE: this backup comes from a different database ("${manifest.database}").`);
    console.log(`      It will be restored into "${db.databaseName}".\n`);
  }

  const nonEmpty: string[] = [];
  for (const c of manifest.collections) {
    const current = existing.get(c.name) ?? 0;
    if (current > 0) nonEmpty.push(c.name);
    const inBackup = c.count >= 0 ? docs(c.count) : "         ? documents";
    const note = current > 0 ? `   target has ${count(current)}${args.drop ? " - will be replaced" : ""}` : "";
    console.log(`  ${c.name.padEnd(18)} ${inBackup}${note}`);
  }
  console.log("");

  if (nonEmpty.length && !args.drop) {
    console.error(`Nothing was changed: these collections already contain data: ${nonEmpty.join(", ")}.`);
    console.error("Add --drop to replace them with the backup (their current contents are deleted).");
    return 1;
  }
  if (!args.yes) {
    if (nonEmpty.length) console.error("Tip: back up the current data first with: npm run db:backup");
    console.error(`Nothing was changed. To restore into database "${db.databaseName}", run again with --yes.`);
    return 1;
  }

  console.log(`Restoring into "${db.databaseName}"...`);
  let problems = 0;
  const results = await restoreDatabase(db, dir, { drop: args.drop }, (c) => {
    const mismatch = c.expected >= 0 && c.expected !== c.count;
    if (mismatch) problems++;
    console.log(
      `  ${c.name.padEnd(18)} ${docs(c.count)}${mismatch ? `   EXPECTED ${count(c.expected)}` : ""}`,
    );
    for (const warning of c.indexWarnings) {
      problems++;
      console.log(`    warning: ${warning}`);
    }
  });

  const total = results.reduce((sum, c) => sum + c.count, 0);
  console.log(`\nRestored ${count(total)} documents in ${results.length} collections into "${db.databaseName}".`);
  console.log("Restart the app (web + worker) so it picks up the restored settings.");
  if (problems) {
    console.error(`${problems} problem${problems === 1 ? "" : "s"} above - check them before relying on this data.`);
    return 1;
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
