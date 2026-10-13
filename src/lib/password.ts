import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

// scrypt password hashing. Stored format: scrypt$<saltHex>$<hashHex>
// Also: one-time tokens for "forgot password" and "set your password" links.

const KEY_LENGTH = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const MIN_PASSWORD_LENGTH = 8;
/** Upper bound so a huge value can't be used to keep the server busy hashing. */
export const MAX_PASSWORD_LENGTH = 200;

// --- Accounts without a password yet (invited teammates) ----------------------

const UNUSABLE_PREFIX = "invited$";

/** Stored instead of a hash until an invited teammate sets a password: random, and no password matches it. */
export function unusablePasswordHash(): string {
  return UNUSABLE_PREFIX + randomBytes(32).toString("hex");
}

/** False for an invited account that has not set its password yet. */
export function hasUsablePassword(stored: string): boolean {
  return stored.startsWith("scrypt$");
}

// --- Random passwords and one-time link tokens -----------------------------------

// No look-alike characters (0/O, 1/l/I), so it can be read out or typed by hand.
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomPassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return out;
}

/** sha256 hex of a link token - only this is stored (users.resetTokenHash), never the token itself. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new random link token and the hash to store for it. */
export function generateResetToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashResetToken(token) };
}

/** Cheap shape check before touching the database. */
export function looksLikeResetToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
