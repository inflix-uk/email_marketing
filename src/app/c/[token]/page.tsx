import type { Metadata } from "next";
import { headers } from "next/headers";
import { after } from "next/server";
import { Alert } from "@/components/ui/form";
import { confirmSubscription, type ConfirmResult } from "@/lib/forms/signup";
import { clientIp } from "@/lib/rate-limit";
import { PublicCard } from "../../f/public-card";

// Public page behind the "Confirm subscription" button of the double opt-in
// email (see src/proxy.ts). The signed token is the authorisation. Opening the
// link confirms; opening it again changes nothing.

export const metadata: Metadata = {
  title: { absolute: "Confirm subscription" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

async function confirm(token: string): Promise<ConfirmResult | null> {
  try {
    const ip = clientIp(await headers());
    return await confirmSubscription(token, ip === "unknown" ? null : ip);
  } catch (err) {
    // Database not configured / unreachable.
    console.error("[forms] confirmation failed", err);
    return null;
  }
}

export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await confirm(token);

  if (!result) {
    return (
      <PublicCard title="Temporarily unavailable">
        <p>We can&apos;t confirm subscriptions right now. Please try the link again in a few minutes.</p>
      </PublicCard>
    );
  }

  // Automations (welcome emails) start after the page was sent.
  after(result.followUp);

  if (result.status === "confirmed" || result.status === "already") {
    return (
      <PublicCard title="Subscription confirmed">
        <Alert tone="success">{result.form?.successMessage ?? "Thanks - your subscription is confirmed."}</Alert>
      </PublicCard>
    );
  }

  if (result.status === "expired") {
    return (
      <PublicCard title="This link has expired">
        <p>Please sign up again to get a new confirmation email.</p>
      </PublicCard>
    );
  }

  return (
    <PublicCard title="Invalid link">
      <p>This confirmation link doesn&apos;t work. Please use the button in the most recent email we sent you.</p>
    </PublicCard>
  );
}
