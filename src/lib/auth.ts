import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { collections, isDuplicateKeyError } from "@/db";
import { newId } from "@/db/schema";
import { hashPassword, verifyPassword } from "./password";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE, verifySessionToken, type Session } from "./session";
import { normalizeEmail } from "./utils";

// Admin accounts live in the `users` collection (created on the setup screen,
// managed on the Settings page). Sessions are signed JWT cookies.

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  // The account must still exist (e.g. its email was changed).
  const { users } = await collections();
  return (await users.countDocuments({ email: session.email }, { limit: 1 })) ? session : null;
}

/** Use at the top of every server action / route handler that reads or changes admin data. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function hasAnyUser(): Promise<boolean> {
  const { users } = await collections();
  return (await users.countDocuments({}, { limit: 1 })) > 0;
}

// Constant-time-ish: always run one scrypt, even for unknown emails.
const DUMMY_HASH = "scrypt$00000000000000000000000000000000$" + "0".repeat(128);

export async function checkCredentials(email: string, password: string): Promise<boolean> {
  const { users } = await collections();
  const user = await users.findOne({ email: normalizeEmail(email) });
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  return Boolean(user) && ok;
}

export async function createUser(email: string, password: string): Promise<void> {
  const { users } = await collections();
  const now = new Date();
  await users.insertOne({
    _id: newId(),
    email: normalizeEmail(email),
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Change the signed-in admin's email and/or password. The current password is
 * always required. Returns an error message, or null on success (and re-issues
 * the session cookie when the email changed).
 */
export async function updateAccount(
  currentEmail: string,
  input: { currentPassword: string; newEmail?: string; newPassword?: string },
): Promise<string | null> {
  const { users } = await collections();
  const user = await users.findOne({ email: currentEmail });
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    return "Your current password is incorrect.";
  }
  const $set: { email?: string; passwordHash?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (input.newEmail && normalizeEmail(input.newEmail) !== user.email) $set.email = normalizeEmail(input.newEmail);
  if (input.newPassword) $set.passwordHash = await hashPassword(input.newPassword);
  try {
    await users.updateOne({ _id: user._id }, { $set });
  } catch (err) {
    if (isDuplicateKeyError(err)) return "Another account already uses that email.";
    throw err;
  }
  if ($set.email) await startSession($set.email);
  return null;
}

export async function startSession(email: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(normalizeEmail(email)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
