"use server";

import { z } from "zod";
import { unsubscribeBySend } from "@/lib/sending";
import { getLinkContext, verifyUnsubscribe } from "@/lib/tokens";

// PUBLIC server action (the recipient isn't logged in), so deliberately no
// requireSession(): the signed link is the authorisation, re-verified here.

export interface UnsubscribeState {
  done?: "unsubscribed" | "already";
  error?: string;
}

const input = z.object({
  sendId: z.string().min(1).max(64),
  s: z.string().min(1).max(64),
});

export async function unsubscribeAction(_prev: UnsubscribeState, formData: FormData): Promise<UnsubscribeState> {
  const parsed = input.safeParse({ sendId: formData.get("sendId"), s: formData.get("s") });
  if (!parsed.success) return { error: "This unsubscribe link is invalid." };
  try {
    const ctx = await getLinkContext();
    if (!verifyUnsubscribe(ctx, parsed.data.sendId, parsed.data.s)) {
      return { error: "This unsubscribe link is invalid." };
    }
    const result = await unsubscribeBySend(parsed.data.sendId);
    if (result === "not_found") {
      return { error: "We couldn't find this subscription - it may already have been removed." };
    }
    return { done: result };
  } catch (err) {
    console.error("[unsubscribe] failed", err);
    return { error: "Something went wrong. Please try again in a moment." };
  }
}
