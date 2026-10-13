"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { collections } from "@/db";
import { createApiKey, revokeApiKey } from "@/lib/api/keys";
import { requireSession } from "@/lib/auth";

const MAX_KEYS = 25;

const nameSchema = z.string().trim().min(1, "Give the key a name.").max(60, "Keep the name under 60 characters.");

export interface CreateKeyState {
  error?: string;
  /** The new key - returned once, never stored in readable form. */
  created?: { name: string; key: string };
}

export async function createApiKeyAction(_prev: CreateKeyState, formData: FormData): Promise<CreateKeyState> {
  await requireSession();
  const parsed = nameSchema.safeParse(String(formData.get("name") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Give the key a name." };

  const { apiKeys } = await collections();
  if ((await apiKeys.countDocuments({}, { limit: MAX_KEYS })) >= MAX_KEYS) {
    return { error: `You can have at most ${MAX_KEYS} API keys. Revoke one you no longer use first.` };
  }

  const { key } = await createApiKey(parsed.data);
  revalidatePath("/settings/api");
  return { created: { name: parsed.data, key } };
}

export async function revokeApiKeyAction(id: string): Promise<void> {
  await requireSession();
  await revokeApiKey(id);
  revalidatePath("/settings/api");
}
