import type { ReactNode } from "react";
import { Card } from "@/components/ui/layout";
import { DEFAULT_BRAND } from "@/lib/forms/confirmation-email";
import { getSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

/** Sender name from Settings; never fails the page. */
async function brandName(): Promise<string> {
  try {
    return (await getSettings()).fromName.trim() || DEFAULT_BRAND;
  } catch {
    return DEFAULT_BRAND;
  }
}

/**
 * Standalone centered card for the public sign-up and confirmation pages (no
 * app chrome). `embed` drops the page background and sender name for iframes.
 */
export async function PublicCard({
  title,
  children,
  embed = false,
}: {
  title: ReactNode;
  children: ReactNode;
  embed?: boolean;
}) {
  const brand = embed ? null : await brandName();
  return (
    <main className={cn("flex justify-center px-4", embed ? "bg-white py-4" : "min-h-screen items-center bg-slate-50 py-12")}>
      <div className="w-full max-w-md">
        {brand ? <p className="mb-4 text-center text-sm font-medium text-slate-500">{brand}</p> : null}
        <Card className={cn("p-6 sm:p-8", embed && "shadow-none ring-0 sm:p-6")}>
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          <div className="mt-3 space-y-4 text-sm leading-6 text-slate-600">{children}</div>
        </Card>
      </div>
    </main>
  );
}
