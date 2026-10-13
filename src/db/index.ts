import { MongoClient, type Db } from "mongodb";
import { getMongoUri } from "@/lib/config";
import type { SettingsDoc } from "@/lib/settings";
import type {
  ApiKeyDoc,
  AutomationDoc,
  CampaignDoc,
  ClickDoc,
  ContactDoc,
  EnrollmentDoc,
  FormDoc,
  ListDoc,
  RateLimitDoc,
  SegmentDoc,
  SendDoc,
  TemplateDoc,
  UserDoc,
} from "./schema";

// Shared by the Next.js server and the background worker (src/worker), so
// this module must not import "server-only" or anything Next-specific.

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("The database is not configured yet - open /setup to connect MongoDB.");
  }
}

interface Connection {
  uri: string;
  client: MongoClient;
  ready: Promise<Db>;
}

const globalForMongo = globalThis as unknown as { mongo?: Connection };

/** Database name from the URI path, e.g. ...mongodb.net/marketing?... */
export function databaseNameFromUri(uri: string): string {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(uri);
  return match?.[1] ? decodeURIComponent(match[1]) : "inflix_marketing";
}

export async function getDb(): Promise<Db> {
  const uri = getMongoUri();
  if (!uri) throw new DatabaseNotConfiguredError();

  const current = globalForMongo.mongo;
  if (current && current.uri === uri) return current.ready;
  if (current) void current.client.close().catch(() => {});

  const client = new MongoClient(uri, { appName: "inflix-marketing", serverSelectionTimeoutMS: 10_000 });
  const ready = client.connect().then(async (c) => {
    const db = c.db(databaseNameFromUri(uri));
    await ensureIndexes(db);
    return db;
  });
  const connection: Connection = { uri, client, ready };
  globalForMongo.mongo = connection;
  // Don't cache a failed connection: the next call retries.
  ready.catch(() => {
    if (globalForMongo.mongo === connection) globalForMongo.mongo = undefined;
    void client.close().catch(() => {});
  });
  return ready;
}

/** Typed collections. Usage: `const { contacts } = await collections();` */
export async function collections() {
  const db = await getDb();
  return {
    contacts: db.collection<ContactDoc>("contacts"),
    lists: db.collection<ListDoc>("lists"),
    templates: db.collection<TemplateDoc>("templates"),
    campaigns: db.collection<CampaignDoc>("campaigns"),
    sends: db.collection<SendDoc>("sends"),
    clicks: db.collection<ClickDoc>("clicks"),
    users: db.collection<UserDoc>("users"),
    settings: db.collection<SettingsDoc>("settings"),
    segments: db.collection<SegmentDoc>("segments"),
    forms: db.collection<FormDoc>("forms"),
    automations: db.collection<AutomationDoc>("automations"),
    enrollments: db.collection<EnrollmentDoc>("enrollments"),
    apiKeys: db.collection<ApiKeyDoc>("apiKeys"),
    rateLimits: db.collection<RateLimitDoc>("rateLimits"),
  };
}

export type Collections = Awaited<ReturnType<typeof collections>>;

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection("contacts").createIndexes([
      { key: { email: 1 }, unique: true },
      { key: { status: 1 } },
      { key: { listIds: 1, status: 1 } },
      { key: { createdAt: -1 } },
      { key: { tags: 1 } },
    ]),
    db.collection("lists").createIndexes([{ key: { createdAt: -1 } }]),
    db.collection("templates").createIndexes([{ key: { updatedAt: -1 } }]),
    db.collection("campaigns").createIndexes([
      { key: { status: 1, scheduledAt: 1 } },
      { key: { updatedAt: -1 } },
    ]),
    db.collection("sends").createIndexes([
      { key: { campaignId: 1, contactId: 1 }, unique: true },
      { key: { status: 1, nextAttemptAt: 1 } },
      { key: { campaignId: 1, status: 1 } },
      { key: { contactId: 1 } },
    ]),
    db.collection("clicks").createIndexes([{ key: { campaignId: 1 } }, { key: { sendId: 1 } }]),
    db.collection("users").createIndexes([{ key: { email: 1 }, unique: true }]),
    db.collection("sends").createIndexes([{ key: { email: 1, sentAt: -1 } }, { key: { messageId: 1 }, sparse: true }]),
    db.collection("enrollments").createIndexes([
      { key: { automationId: 1, contactId: 1 }, unique: true },
      { key: { status: 1, nextRunAt: 1 } },
    ]),
    db.collection("automations").createIndexes([{ key: { status: 1 } }]),
    db.collection("apiKeys").createIndexes([{ key: { keyHash: 1 }, unique: true }]),
    db.collection("rateLimits").createIndexes([{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }]),
  ]);
}

/** Try a connection string without saving it (used by the setup screen). */
export async function testMongoUri(uri: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8_000, connectTimeoutMS: 8_000 });
  try {
    await client.connect();
    await client.db(databaseNameFromUri(uri)).command({ ping: 1 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Close the shared connection (worker shutdown, scripts). */
export async function closeDb(): Promise<void> {
  const current = globalForMongo.mongo;
  globalForMongo.mongo = undefined;
  if (current) await current.client.close().catch(() => {});
}

/** True when a Mongo duplicate-key error (E11000) was thrown. */
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}
