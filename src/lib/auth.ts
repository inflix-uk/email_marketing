import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { collections, isDuplicateKeyError } from "@/db";
import { newId } from "@/db/schema";
import { sendEmail, type SendResult } from "./mailer";
import {
  generateResetToken,
  hashPassword,
  hashResetToken,
  hasUsablePassword,
  looksLikeResetToken,
  unusablePasswordHash,
  verifyPassword,
} from "./password";
import { escapeHtml } from "./render";
import {
  createSessionToken,
  isSessionCurrent,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  verifySessionToken,
  type Session,
} from "./session";
import { getSettings, isDevMailer } from "./settings";
import { normalizeEmail } from "./utils";

// Accounts live in the `users` collection (the first one is created on the
// setup screen, teammates on Settings > Team). Sessions are signed JWT cookies
// that carry the user's `sessionVersion`: bumping it signs that user out
// everywhere.

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  // The account must still exist (it may have been removed or its email
  // changed) and the cookie must not have been revoked since it was issued.
  const { users } = await collections();
  const user = await users.findOne({ email: session.email }, { projection: { sessionVersion: 1 } });
  return user && isSessionCurrent(session, user.sessionVersion) ? session : null;
}

/** Use at the top of every server action / route handler that reads or changes admin data. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Sign this browser in. `sessionVersion` is looked up when the caller doesn't already have it. */
export async function startSession(email: string, sessionVersion?: number): Promise<void> {
  const normalized = normalizeEmail(email);
  let version = sessionVersion;
  if (version === undefined) {
    const { users } = await collections();
    const user = await users.findOne({ email: normalized }, { projection: { sessionVersion: 1 } });
    version = user?.sessionVersion ?? 0;
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(normalized, version), {
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

/**
 * Sign this user out on every device: all cookies issued so far stop working.
 * Returns false when there is no such account.
 */
export async function signOutEverywhere(email: string): Promise<boolean> {
  const { users } = await collections();
  const result = await users.updateOne(
    { email: normalizeEmail(email) },
    { $inc: { sessionVersion: 1 }, $set: { updatedAt: new Date() } },
  );
  return result.matchedCount > 0;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function hasAnyUser(): Promise<boolean> {
  const { users } = await collections();
  return (await users.countDocuments({}, { limit: 1 })) > 0;
}

// Constant-time-ish: always run one scrypt, even for unknown emails.
const DUMMY_HASH = "scrypt$00000000000000000000000000000000$" + "0".repeat(128);

export async function checkCredentials(email: string, password: string): Promise<boolean> {
  const { users } = await collections();
  const user = await users.findOne({ email: normalizeEmail(email) }, { projection: { passwordHash: 1 } });
  // Unknown email, or an invited teammate with no password yet: still hash once, then refuse.
  const usable = user && hasUsablePassword(user.passwordHash) ? user.passwordHash : null;
  const ok = await verifyPassword(password, usable ?? DUMMY_HASH);
  return Boolean(usable) && ok;
}

export async function createUser(email: string, password: string, name?: string | null): Promise<void> {
  const { users } = await collections();
  const now = new Date();
  await users.insertOne({
    _id: newId(),
    email: normalizeEmail(email),
    passwordHash: await hashPassword(password),
    name: name?.trim() || null,
    sessionVersion: 0,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Change the signed-in user's email and/or password. The current password is
 * always required. Returns an error message, or null on success.
 *
 * A new password signs the user out on every other device; this browser gets
 * a fresh cookie (also when only the email changed).
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
  const $set: {
    email?: string;
    passwordHash?: string;
    resetTokenHash?: null;
    resetTokenExpiresAt?: null;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (input.newEmail && normalizeEmail(input.newEmail) !== user.email) $set.email = normalizeEmail(input.newEmail);
  if (input.newPassword) {
    $set.passwordHash = await hashPassword(input.newPassword);
    // Any emailed "reset password" link dies with the old password.
    $set.resetTokenHash = null;
    $set.resetTokenExpiresAt = null;
  }
  let updated;
  try {
    updated = await users.findOneAndUpdate(
      { _id: user._id },
      input.newPassword ? { $set, $inc: { sessionVersion: 1 } } : { $set },
      { returnDocument: "after", projection: { email: 1, sessionVersion: 1 } },
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) return "Another account already uses that email.";
    throw err;
  }
  if (updated && ($set.email || input.newPassword)) await startSession(updated.email, updated.sessionVersion ?? 0);
  return null;
}

// ---------------------------------------------------------------------------
// Password links ("forgot password" and "set your password" for new teammates)
//
// One mechanism: a random token goes into the link, only its sha256 is stored
// on the user together with an expiry. Using the link sets a password, clears
// the token (single use) and bumps sessionVersion.
// ---------------------------------------------------------------------------

export type PasswordLinkKind = "reset" | "invite";

export const RESET_LINK_HOURS = 1;
export const INVITE_LINK_DAYS = 7;

const LINK_LIFETIME_MS: Record<PasswordLinkKind, number> = {
  reset: RESET_LINK_HOURS * 60 * 60 * 1000,
  invite: INVITE_LINK_DAYS * 24 * 60 * 60 * 1000,
};

export interface PasswordLink {
  url: string;
  expiresAt: Date;
}

/**
 * Issue a new link for this account (replacing any earlier one). Null when
 * there is no such account. The link uses the app URL from Settings, never the
 * request's Host header.
 */
export async function createPasswordLink(email: string, kind: PasswordLinkKind): Promise<PasswordLink | null> {
  const { users } = await collections();
  const { token, hash } = generateResetToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LINK_LIFETIME_MS[kind]);
  const result = await users.updateOne(
    { email: normalizeEmail(email) },
    { $set: { resetTokenHash: hash, resetTokenExpiresAt: expiresAt, updatedAt: now } },
  );
  if (!result.matchedCount) return null;
  const appUrl = (await getSettings()).appUrl.replace(/\/+$/, "");
  return { url: `${appUrl}/reset-password?token=${token}`, expiresAt };
}

/** Who a link belongs to, if it is still valid. Does not use it up. */
export async function checkPasswordLink(token: string): Promise<{ email: string; isNewAccount: boolean } | null> {
  if (!looksLikeResetToken(token)) return null;
  const { users } = await collections();
  const user = await users.findOne(
    { resetTokenHash: hashResetToken(token), resetTokenExpiresAt: { $gt: new Date() } },
    { projection: { email: 1, passwordHash: 1 } },
  );
  return user ? { email: user.email, isNewAccount: !hasUsablePassword(user.passwordHash) } : null;
}

/**
 * Set a new password with a link token. The token is claimed atomically, so
 * it works exactly once. Returns the account (to start a session), or null
 * when the link is invalid, expired or already used.
 */
export async function redeemPasswordLink(
  token: string,
  newPassword: string,
): Promise<{ email: string; sessionVersion: number } | null> {
  // Checked first, so junk tokens never cost a password hash.
  if (!(await checkPasswordLink(token))) return null;
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();
  const { users } = await collections();
  const user = await users.findOneAndUpdate(
    { resetTokenHash: hashResetToken(token), resetTokenExpiresAt: { $gt: now } },
    {
      $set: { passwordHash, resetTokenHash: null, resetTokenExpiresAt: null, updatedAt: now },
      $inc: { sessionVersion: 1 },
    },
    { returnDocument: "after", projection: { email: 1, sessionVersion: 1 } },
  );
  return user ? { email: user.email, sessionVersion: user.sessionVersion ?? 0 } : null;
}

/**
 * "Forgot password": email a reset link if the account exists. Callers show
 * the same answer either way. Returns what happened, for logging and tests.
 */
export async function sendPasswordResetIfAccountExists(email: string): Promise<"sent" | "no-account" | "invite-pending"> {
  const normalized = normalizeEmail(email);
  const { users } = await collections();
  const user = await users.findOne(
    { email: normalized },
    { projection: { passwordHash: 1, resetTokenExpiresAt: 1 } },
  );
  if (!user) return "no-account";

  const invited = !hasUsablePassword(user.passwordHash);
  if (invited && isDevMailer(await getSettings()) && user.resetTokenExpiresAt && user.resetTokenExpiresAt > new Date()) {
    // No email provider, so a new link could not reach them - and issuing one
    // would break the "set your password" link they were given by hand.
    return "invite-pending";
  }
  const kind: PasswordLinkKind = invited ? "invite" : "reset";
  const link = await createPasswordLink(normalized, kind);
  if (!link) return "no-account";
  await sendPasswordLinkEmail(normalized, link.url, kind);
  return "sent";
}

/** Email a password link with the sender from Settings (in test mode it is saved to data/outbox). */
export async function sendPasswordLinkEmail(to: string, url: string, kind: PasswordLinkKind): Promise<SendResult> {
  const settings = await getSettings();
  if (!settings.fromEmail && !isDevMailer(settings)) {
    throw new Error("No From email is set - add one on the Settings page.");
  }
  const copy =
    kind === "invite"
      ? {
          subject: "Set your password for Inflix Marketing",
          heading: "You've been added to Inflix Marketing",
          intro: "Choose a password to finish setting up your account.",
          button: "Set your password",
          expiry: `This link works once, for ${INVITE_LINK_DAYS} days.`,
          ignore: "If you weren't expecting this, you can ignore this email.",
        }
      : {
          subject: "Reset your Inflix Marketing password",
          heading: "Reset your password",
          intro: "We got a request to reset the password for your Inflix Marketing account.",
          button: "Choose a new password",
          expiry: `This link works once, for ${RESET_LINK_HOURS} hour.`,
          ignore: "If you didn't ask for this, you can ignore this email - your password stays the same.",
        };
  const safeUrl = escapeHtml(url);
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(copy.subject)}</title></head>
<body style="margin:0;padding:32px 16px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px 32px;font-size:15px;line-height:22px;color:#334155;">
<h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${escapeHtml(copy.heading)}</h1>
<p style="margin:0 0 20px;">${escapeHtml(copy.intro)}</p>
<p style="margin:0 0 20px;"><a href="${safeUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:bold;border-radius:6px;padding:10px 18px;">${escapeHtml(copy.button)}</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#64748b;">Or copy this address into your browser:<br><a href="${safeUrl}" style="color:#4f46e5;word-break:break-all;">${safeUrl}</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#64748b;">${escapeHtml(copy.expiry)} ${escapeHtml(copy.ignore)}</p>
</div>
</body></html>`;
  const text = `${copy.heading}\n\n${copy.intro}\n\n${copy.button}: ${url}\n\n${copy.expiry} ${copy.ignore}\n`;
  return sendEmail({
    to,
    from: { name: settings.fromName || "Inflix Marketing", address: settings.fromEmail || "no-reply@localhost" },
    replyTo: settings.replyTo || null,
    subject: copy.subject,
    html,
    text,
  });
}

// ---------------------------------------------------------------------------
// Team (Settings > Team). Every account has the same access.
// ---------------------------------------------------------------------------

export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  /** Invited, but has not set a password yet. */
  pending: boolean;
}

export async function listTeam(): Promise<TeamMember[]> {
  const { users } = await collections();
  const docs = await users
    .find({}, { projection: { email: 1, name: 1, createdAt: 1, passwordHash: 1 } })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  return docs.map((u) => ({
    id: u._id,
    email: u.email,
    name: u.name ?? null,
    createdAt: u.createdAt,
    pending: !hasUsablePassword(u.passwordHash),
  }));
}

/**
 * Create an account with no usable password and a "set your password" link.
 * Returns null when the email already has an account.
 */
export async function inviteTeammate(email: string, name: string | null): Promise<PasswordLink | null> {
  const { users } = await collections();
  const now = new Date();
  const normalized = normalizeEmail(email);
  try {
    await users.insertOne({
      _id: newId(),
      email: normalized,
      passwordHash: unusablePasswordHash(),
      name: name?.trim() || null,
      sessionVersion: 0,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) return null;
    throw err;
  }
  return createPasswordLink(normalized, "invite");
}

/** A fresh "set your password" link for a teammate who has not set one yet (the old link stops working). */
export async function renewInviteLink(userId: string): Promise<(PasswordLink & { email: string }) | null> {
  const { users } = await collections();
  const user = await users.findOne({ _id: userId }, { projection: { email: 1, passwordHash: 1 } });
  if (!user || hasUsablePassword(user.passwordHash)) return null;
  const link = await createPasswordLink(user.email, "invite");
  return link ? { ...link, email: user.email } : null;
}

export type RemoveTeammateError = "self" | "last" | "gone";

/**
 * Remove an account (its sessions stop working at once). Never your own and
 * never the last one. Returns null on success.
 */
export async function removeTeammate(userId: string, actingEmail: string): Promise<RemoveTeammateError | null> {
  const { users } = await collections();
  const target = await users.findOne({ _id: userId }, { projection: { email: 1 } });
  if (!target) return "gone";
  if (target.email === actingEmail) return "self";
  if ((await users.countDocuments({}, { limit: 2 })) < 2) return "last";

  const removed = await users.findOneAndDelete({ _id: userId, email: { $ne: actingEmail } });
  if (!removed) return "gone";
  // Two people removing each other at the same moment could empty the
  // collection (which would reopen the setup screen): put the account back.
  if ((await users.countDocuments({}, { limit: 1 })) === 0) {
    await users.insertOne(removed).catch(() => {});
    return "last";
  }
  return null;
}
