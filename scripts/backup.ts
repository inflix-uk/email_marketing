// Back up the whole database to data/backups/<timestamp>/ (one .jsonl file per collection):
//   npm run db:backup
//   npm run db:backup -- path/to/folder     (a folder of your choice instead)
// Restore with: npm run db:restore -- <folder>
import "../src/worker/load-env";
import path from "node:path";
import { closeDb, getDb } from "../src/db";
import { backupDatabase, backupFolderName, hostsFromUri, SKIPPED_COLLECTIONS } from "../src/lib/backup";
import { getMongoUri } from "../src/lib/config";

const count = (n: number) => new Intl.NumberFormat("en-GB").format(n);
const docs = (n: number) => `${count(n).padStart(10)} ${n === 1 ? "document" : "documents"}`;

async function main() {
  const target = process.argv[2];
  if (target?.startsWith("-")) throw new Error(`Unknown option ${target}. Usage: npm run db:backup [-- <folder>]`);

  const db = await getDb();
  const dir = target ? path.resolve(target) : path.join(process.cwd(), "data", "backups", backupFolderName(new Date()));
  console.log(`Backing up database "${db.databaseName}" on ${hostsFromUri(getMongoUri() ?? "")}`);
  console.log(`to ${dir}\n`);

  const manifest = await backupDatabase(db, dir, (c) => {
    console.log(`  ${c.name.padEnd(18)} ${docs(c.count)}`);
  });

  const total = manifest.collections.reduce((sum, c) => sum + c.count, 0);
  console.log(`\nDone: ${count(total)} documents in ${manifest.collections.length} collections.`);
  console.log(`Not included: ${SKIPPED_COLLECTIONS.join(", ")} (temporary counters).`);
  console.log("Keep this folder private - it contains your email provider password and the account password hashes.");
  console.log(`Restore with: npm run db:restore -- "${(path.relative(process.cwd(), dir) || dir).split(path.sep).join("/")}"`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
