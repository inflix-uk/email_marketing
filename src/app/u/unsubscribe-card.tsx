import type { ReactNode } from "react";
import { connection } from "next/server";
import { Card } from "@/components/ui/layout";
import { getSettings } from "@/lib/settings";

const DEFAULT_BRAND = "Inflix Marketing";

/** Sender name from Settings, rendered per request; never fails the page. */
async function brandName(): Promise<string> {
  await connection();
  try {
    return (await getSettings()).fromName.trim() || DEFAULT_BRAND;
  } catch {
    return DEFAULT_BRAND;
  }
}

/** Standalone centered card for the public unsubscribe pages (no app chrome). */
export async function UnsubscribeCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  const brand = await brandName();
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <p className="mb-4 text-center text-sm font-medium text-slate-500">{brand}</p>
        <Card className="p-6 sm:p-8">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          <div className="mt-3 space-y-4 text-sm leading-6 text-slate-600">{children}</div>
        </Card>
      </div>
    </main>
  );
}
