import { getDb } from "@/db";
import { hasAnyUser } from "./auth";
import { getMongoUri } from "./config";

export type SetupState =
  | { step: "connect"; error?: string } // no connection string yet, or it doesn't work
  | { step: "account" } // connected, but no admin account yet
  | { step: "done" };

/** Where the app is in first-run setup. */
export async function getSetupState(): Promise<SetupState> {
  if (!getMongoUri()) return { step: "connect" };
  try {
    await getDb();
    return (await hasAnyUser()) ? { step: "done" } : { step: "account" };
  } catch (err) {
    return { step: "connect", error: err instanceof Error ? err.message : String(err) };
  }
}
