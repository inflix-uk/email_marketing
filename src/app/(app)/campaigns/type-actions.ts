"use server";

// Server actions for campaign types (A/B test, auto resend, RSS series).
// Kept apart from ./actions.ts; the compose form's own save lives there.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { chooseVariantWinner, fetchFeed, runRssSeriesNow } from "@/lib/campaign-types";
import { FeedError } from "@/lib/campaign-types/rss-feed";
import { CampaignError } from "@/lib/sending";
import type { ActionState } from "./actions";

const idSchema = z.string().trim().min(1).max(64);

export interface FeedPreview {
  ok?: boolean;
  error?: string;
  title?: string;
  items?: { title: string; link: string | null; excerpt: string; image: string | null; publishedAt: string | null }[];
}

/** "Check feed": fetch the feed and show its newest posts. */
export async function previewFeed(url: string): Promise<FeedPreview> {
  await requirePermission("edit");
  const parsed = z.string().trim().min(1, "Enter the feed address.").max(2000).safeParse(url);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter the feed address." };
  try {
    const feed = await fetchFeed(parsed.data);
    return {
      ok: true,
      title: feed.title,
      items: feed.items.slice(0, 3).map((i) => ({
        title: i.title,
        link: i.link,
        excerpt: i.excerpt,
        image: i.image,
        publishedAt: i.publishedAt ? i.publishedAt.toISOString() : null,
      })),
    };
  } catch (err) {
    if (err instanceof FeedError) return { error: err.message };
    console.error("[campaigns] feed preview", err);
    return { error: "The feed couldn't be read." };
  }
}

/** "Pick this version" on an A/B test (bound to campaign id + version key). */
export async function pickWinner(campaignId: string, key: string): Promise<ActionState> {
  await requirePermission("send");
  const id = idSchema.safeParse(campaignId);
  const k = z.string().regex(/^[A-H]$/).safeParse(key);
  if (!id.success || !k.success) return { error: "That version doesn't exist." };
  try {
    const winner = await chooseVariantWinner(id.data, k.data);
    revalidatePath("/campaigns", "layout");
    return { ok: true, message: `Version ${winner} will be sent to the rest.` };
  } catch (err) {
    if (err instanceof CampaignError) return { error: err.message };
    console.error("[campaigns] pick winner", err);
    return { error: "Something went wrong. Please try again." };
  }
}

/** "Check feed now" on an active RSS series. */
export async function checkSeriesNow(seriesId: string): Promise<ActionState> {
  await requirePermission("send");
  const id = idSchema.safeParse(seriesId);
  if (!id.success) return { error: "This series no longer exists." };
  try {
    await runRssSeriesNow(id.data);
    revalidatePath("/campaigns", "layout");
    return { ok: true, message: "The feed will be checked in a moment." };
  } catch (err) {
    if (err instanceof CampaignError) return { error: err.message };
    console.error("[campaigns] rss check now", err);
    return { error: "Something went wrong. Please try again." };
  }
}
