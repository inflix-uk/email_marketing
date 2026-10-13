import type { Metadata } from "next";
import { getUnsubscribeInfo, maskEmail, type UnsubscribeInfo } from "@/lib/sending";
import { getLinkContext, verifyUnsubscribe } from "@/lib/tokens";
import { UnsubscribeCard } from "../unsubscribe-card";
import { UnsubscribeForm } from "./unsubscribe-form";

// Public page linked from every campaign and automation email (see
// src/proxy.ts): leave individual lists, or unsubscribe from all emails.

export const metadata: Metadata = {
  title: { absolute: "Unsubscribe" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Lookup = { ok: true; valid: boolean; info: UnsubscribeInfo | null } | { ok: false };

async function lookUp(sendId: string, signature: string): Promise<Lookup> {
  try {
    const ctx = await getLinkContext();
    if (!verifyUnsubscribe(ctx, sendId, signature)) return { ok: true, valid: false, info: null };
    return { ok: true, valid: true, info: await getUnsubscribeInfo(sendId) };
  } catch (err) {
    // Database not configured / unreachable.
    console.error("[unsubscribe] page lookup failed", err);
    return { ok: false };
  }
}

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ sendId: string }>;
  searchParams: Promise<{ s?: string | string[] }>;
}) {
  const { sendId } = await params;
  const { s } = await searchParams;
  const signature = typeof s === "string" ? s : "";

  const result = await lookUp(sendId, signature);

  if (!result.ok) {
    return (
      <UnsubscribeCard title="Temporarily unavailable">
        <p>We can&apos;t process unsubscribe requests right now. Please try again in a few minutes.</p>
      </UnsubscribeCard>
    );
  }

  if (!result.valid) {
    return (
      <UnsubscribeCard title="Invalid link">
        <p>This unsubscribe link is invalid. Please use the link from the bottom of the most recent email you received from us.</p>
      </UnsubscribeCard>
    );
  }

  if (!result.info) {
    return (
      <UnsubscribeCard title="Subscription not found">
        <p>We couldn&apos;t find this subscription - it may already have been removed. You won&apos;t receive further emails for it.</p>
      </UnsubscribeCard>
    );
  }

  const { email, contactStatus, lists } = result.info;
  const active = contactStatus === "subscribed" || contactStatus === "pending";

  return (
    <UnsubscribeCard title={active && lists.length > 0 ? "Email preferences" : "Unsubscribe"}>
      <UnsubscribeForm
        sendId={sendId}
        signature={signature}
        maskedEmail={maskEmail(email)}
        alreadyUnsubscribed={!active}
        lists={lists}
      />
    </UnsubscribeCard>
  );
}
