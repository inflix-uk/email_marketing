"use server";

import { z } from "zod";
import { getUnsubscribeInfo, leaveLists, unsubscribeBySend } from "@/lib/sending";
import { getLinkContext, verifyUnsubscribe } from "@/lib/tokens";

// PUBLIC server action (the recipient isn't logged in), so deliberately no
// requireSession(): the signed link is the authorisation, re-verified here.

export interface UnsubscribeState {
  done?: "unsubscribed" | "already" | "saved";
  /** After "saved": the lists the contact is still on. */
  lists?: { id: string; name: string }[];
  error?: string;
}

const listIds = z.array(z.string().min(1).max(64)).max(500);

const input = z.object({
  sendId: z.string().min(1).max(64),
  s: z.string().min(1).max(64),
  /** "save" = leave the unticked lists; anything else = unsubscribe from everything. */
  intent: z.string().max(20).nullish(),
  /** Lists that were shown on the page... */
  shown: listIds,
  /** ...and the ones left ticked. */
  keep: listIds,
});

const strings = (values: FormDataEntryValue[]) => values.filter((v): v is string => typeof v === "string");

export async function unsubscribeAction(_prev: UnsubscribeState, formData: FormData): Promise<UnsubscribeState> {
  const parsed = input.safeParse({
    sendId: formData.get("sendId"),
    s: formData.get("s"),
    intent: formData.get("intent"),
    shown: strings(formData.getAll("shown")),
    keep: strings(formData.getAll("keep")),
  });
  if (!parsed.success) return { error: "This unsubscribe link is invalid." };
  const { sendId, s, intent, shown, keep } = parsed.data;
  const notFound = { error: "We couldn't find this subscription - it may already have been removed." };
  try {
    const ctx = await getLinkContext();
    if (!verifyUnsubscribe(ctx, sendId, s)) return { error: "This unsubscribe link is invalid." };

    if (intent === "save") {
      // Only lists that were on the page can be left: one added since stays untouched.
      const left = await leaveLists(sendId, shown.filter((id) => !keep.includes(id)));
      const info = left ? await getUnsubscribeInfo(sendId) : null;
      return info ? { done: "saved", lists: info.lists } : notFound;
    }

    const result = await unsubscribeBySend(sendId);
    return result === "not_found" ? notFound : { done: result };
  } catch (err) {
    console.error("[unsubscribe] failed", err);
    return { error: "Something went wrong. Please try again in a moment." };
  }
}
