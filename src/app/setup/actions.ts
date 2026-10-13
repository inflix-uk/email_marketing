"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { closeDb, testMongoUri } from "@/db";
import { createUser, startSession } from "@/lib/auth";
import { isMongoUriFromEnv, isValidMongoUri, saveMongoUri } from "@/lib/config";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { updateSettings } from "@/lib/settings";
import { getSetupState } from "@/lib/setup";

export interface SetupFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export async function connectDatabase(_prev: SetupFormState, formData: FormData): Promise<SetupFormState> {
  // Only while nothing is set up - never let this repoint a working install.
  const state = await getSetupState();
  if (state.step === "done") redirect("/login");
  if (isMongoUriFromEnv()) return { error: "The connection string is set by the MONGODB_URI environment variable." };

  const uri = String(formData.get("uri") ?? "").trim();
  if (!isValidMongoUri(uri)) {
    return { fieldErrors: { uri: ["Paste a connection string starting with mongodb+srv:// or mongodb://"] } };
  }
  const result = await testMongoUri(uri);
  if (!result.ok) {
    return { error: `Could not connect: ${result.error}. Check the password and that your IP is allowed in Atlas → Network Access.` };
  }
  saveMongoUri(uri);
  await closeDb();
  redirect("/setup");
}

const accountSchema = z
  .object({
    email: z.email("Enter a valid email address"),
    password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Passwords don't match" });

export async function createAdmin(_prev: SetupFormState, formData: FormData): Promise<SetupFormState> {
  const state = await getSetupState();
  if (state.step !== "account") redirect(state.step === "done" ? "/login" : "/setup");

  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  await createUser(parsed.data.email, parsed.data.password);

  // Sensible first defaults - all editable on the Settings page.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  await updateSettings({
    ...(host ? { appUrl: `${proto}://${host}` } : {}),
    fromEmail: parsed.data.email,
    replyTo: parsed.data.email,
  });

  await startSession(parsed.data.email);
  redirect("/");
}
