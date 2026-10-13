import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/layout";
import { getSession } from "@/lib/auth";
import { getSetupState } from "@/lib/setup";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if ((await getSetupState()).step !== "done") redirect("/setup");
  if (await getSession()) redirect("/");

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 font-bold text-white">I</span>
          <span className="text-lg font-semibold text-slate-900">Inflix Marketing</span>
        </div>
        <Card className="p-6">
          <h1 className="mb-4 text-lg font-semibold text-slate-900">Sign in</h1>
          <LoginForm next={next ?? "/"} />
        </Card>
      </div>
    </div>
  );
}
