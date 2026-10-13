import { jwtVerify, SignJWT } from "jose";
import { getAuthSecret } from "./settings";

// Session token helpers (JWT signed with the stored auth secret).

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface Session {
  email: string;
  /**
   * The user's `sessionVersion` when the token was issued. getSession() rejects
   * the token once the user's version has moved on (password change, "sign out
   * everywhere"). Tokens issued before this existed count as version 0.
   */
  sessionVersion: number;
}

async function key() {
  return new TextEncoder().encode(await getAuthSecret());
}

export async function createSessionToken(email: string, sessionVersion = 0): Promise<string> {
  return new SignJWT({ email, sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(await key());
}

/** Checks the signature and expiry only - getSession() in lib/auth.ts also checks the user and its version. */
export async function verifySessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await key(), { algorithms: ["HS256"] });
    if (typeof payload.email !== "string") return null;
    const sv = payload.sv;
    if (sv !== undefined && !(typeof sv === "number" && Number.isInteger(sv) && sv >= 0)) return null;
    return { email: payload.email, sessionVersion: sv ?? 0 };
  } catch {
    return null;
  }
}

/** Pure: does a verified token still match the user's current session version? */
export function isSessionCurrent(session: Session, userSessionVersion: number | null | undefined): boolean {
  return session.sessionVersion === (userSessionVersion ?? 0);
}
