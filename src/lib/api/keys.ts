import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { collections } from "@/db";
import { newId, type ApiKeyDoc } from "@/db/schema";

// API keys for the public REST API (/api/v1). The full key is shown once when
// it is created; only its sha256 hash and a short prefix are stored.

export const API_KEY_PREFIX = "ifx_";
/** Characters of the key kept readable in the UI ("ifx_" + 8). */
const VISIBLE_LENGTH = API_KEY_PREFIX.length + 8;
const KEY_RE = /^ifx_[A-Za-z0-9_-]{32,64}$/;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** A new random key with the values to store for it. Pure apart from the randomness. */
export function generateApiKey(): { key: string; keyHash: string; prefix: string } {
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, keyHash: hashApiKey(key), prefix: key.slice(0, VISIBLE_LENGTH) };
}

/** The key from an `Authorization: Bearer <key>` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match ? match[1] : null;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function listApiKeys(): Promise<ApiKeyInfo[]> {
  const { apiKeys } = await collections();
  const docs = await apiKeys.find({}, { projection: { keyHash: 0 }, sort: { createdAt: -1 } }).toArray();
  return docs.map((d) => ({ id: d._id, name: d.name, prefix: d.prefix, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt }));
}

/** Create a key. The returned `key` is the only time the full value is available. */
export async function createApiKey(name: string): Promise<{ id: string; key: string; prefix: string }> {
  const { apiKeys } = await collections();
  const { key, keyHash, prefix } = generateApiKey();
  const id = newId();
  await apiKeys.insertOne({ _id: id, name, keyHash, prefix, createdAt: new Date(), lastUsedAt: null });
  return { id, key, prefix };
}

/** Delete a key: requests using it get 401 from now on. */
export async function revokeApiKey(id: string): Promise<boolean> {
  const { apiKeys } = await collections();
  return (await apiKeys.deleteOne({ _id: id })).deletedCount > 0;
}

/**
 * The key document for a presented key (and note that it was used), or null.
 * The lookup is by hash through the unique index, never by comparing key text.
 */
export async function authenticateApiKey(key: string | null): Promise<ApiKeyDoc | null> {
  if (!key || !KEY_RE.test(key)) return null;
  const keyHash = hashApiKey(key);
  const { apiKeys } = await collections();
  const doc = await apiKeys.findOneAndUpdate({ keyHash }, { $set: { lastUsedAt: new Date() } });
  if (!doc) return null;
  const stored = Buffer.from(doc.keyHash);
  const presented = Buffer.from(keyHash);
  return stored.length === presented.length && timingSafeEqual(stored, presented) ? doc : null;
}
