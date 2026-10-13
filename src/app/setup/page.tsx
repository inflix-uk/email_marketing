import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Card } from "@/components/ui/layout";
import { getSetupState } from "@/lib/setup";
import { AccountForm, ConnectForm } from "./setup-forms";

export const metadata: Metadata = { title: "Setup", robots: { index: false } };

export default async function SetupPage() {
  // Setup state lives in data/config.json + the database: always check it live, never prerender.
  await connection();
  const state = await getSetupState();
  if (state.step === "done") redirect("/login");

  const step = state.step === "connect" ? 1 : 2;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 font-bold text-white">I</span>
          <span className="text-lg font-semibold text-slate-900">Inflix Marketing</span>
        </div>
        <Card className="p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-600">Setup · step {step} of 2</p>
          {state.step === "connect" ? (
            <>
              <h1 className="mt-1 text-lg font-semibold text-slate-900">Connect your database</h1>
              <p className="mb-5 mt-1 text-sm text-slate-500">Your contacts, campaigns and settings are stored in MongoDB.</p>
              <ConnectForm initialError={state.error} />
            </>
          ) : (
            <>
              <h1 className="mt-1 text-lg font-semibold text-slate-900">Create your admin account</h1>
              <p className="mb-5 mt-1 text-sm text-slate-500">You&apos;ll use this to sign in. You can change it later in Settings.</p>
              <AccountForm />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
