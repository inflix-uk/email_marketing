import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  backupFolderName,
  cleanIndex,
  collectionForFile,
  fileForCollection,
  hostsFromUri,
  parseRestoreArgs,
  shouldBackUp,
} from "./index";

describe("backupFolderName", () => {
  test("is a UTC timestamp that is a valid folder name and sorts by time", () => {
    assert.equal(backupFolderName(new Date("2026-10-13T09:30:05.123Z")), "2026-10-13_09-30-05");
    const names = [new Date("2026-10-13T09:30:05Z"), new Date("2026-02-01T00:00:00Z"), new Date("2026-10-13T10:00:00Z")].map(backupFolderName);
    assert.deepEqual([...names].sort(), [names[1], names[0], names[2]]);
    assert.match(names[0], /^[0-9_-]+$/);
  });
});

describe("which collections are backed up", () => {
  test("everything except rate-limit counters and system collections", () => {
    assert.equal(shouldBackUp("contacts"), true);
    assert.equal(shouldBackUp("users"), true);
    assert.equal(shouldBackUp("uploads.files"), true);
    assert.equal(shouldBackUp("uploads.chunks"), true);
    assert.equal(shouldBackUp("rateLimits"), false);
    assert.equal(shouldBackUp("system.views"), false);
  });

  test("file names round-trip to collection names", () => {
    for (const name of ["contacts", "uploads.chunks", "odd name/with:chars"]) {
      const file = fileForCollection(name);
      assert.match(file, /^[^/\\:]+\.jsonl$/);
      assert.equal(collectionForFile(file), name);
    }
    assert.equal(fileForCollection("uploads.files"), "uploads.files.jsonl");
    assert.equal(collectionForFile("backup.json"), null);
    assert.equal(collectionForFile(".jsonl"), null);
    assert.equal(collectionForFile("%E0%A4%A.jsonl"), null);
  });
});

describe("hostsFromUri", () => {
  test("shows the host but never the login", () => {
    assert.equal(hostsFromUri("mongodb://127.0.0.1:27017/inflix_dev"), "127.0.0.1:27017");
    assert.equal(hostsFromUri("mongodb+srv://jane:s3cret@cluster0.abcde.mongodb.net/marketing?retryWrites=true"), "cluster0.abcde.mongodb.net");
    assert.equal(hostsFromUri("mongodb://jane:s3cret@a.example.com:27017,b.example.com:27017/db"), "a.example.com:27017,b.example.com:27017");
    assert.equal(hostsFromUri("nonsense"), "unknown host");
  });
});

describe("parseRestoreArgs", () => {
  test("folder plus flags in any order", () => {
    assert.deepEqual(parseRestoreArgs(["data/backups/x"]), { folder: "data/backups/x", drop: false, yes: false, unknown: [] });
    assert.deepEqual(parseRestoreArgs(["--yes", "data/backups/x", "--drop"]), { folder: "data/backups/x", drop: true, yes: true, unknown: [] });
    assert.deepEqual(parseRestoreArgs([]), { folder: null, drop: false, yes: false, unknown: [] });
  });

  test("reports anything it does not understand instead of guessing", () => {
    assert.deepEqual(parseRestoreArgs(["a", "b", "--force"]).unknown, ["b", "--force"]);
  });
});

describe("cleanIndex", () => {
  test("keeps the definition, drops what the server adds", () => {
    assert.deepEqual(cleanIndex({ v: 2, key: { email: 1 }, name: "email_1", unique: true, ns: "db.users" }), {
      key: { email: 1 },
      name: "email_1",
      unique: true,
    });
    assert.deepEqual(cleanIndex({ v: 2, key: { expiresAt: 1 }, name: "expiresAt_1", expireAfterSeconds: 0 }), {
      key: { expiresAt: 1 },
      name: "expiresAt_1",
      expireAfterSeconds: 0,
    });
  });
});
