import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { RESET_LINK_HOURS } from "@/lib/auth";
import { getSetupState } from "@/lib/setup";
import { AuthShell } from "../login/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

export default async function ForgotPasswordPage() {
  // Depends on live setup state: never prerender.
  await connection();
  if ((await getSetupState()).step !== "done") redirect("/setup");

  return (
    <AuthShell
      title="Forgot your password?"
      description="Enter your email and we'll send you a link to choose a new one."
      footer={
        <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
          &larr; Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm linkHours={RESET_LINK_HOURS} />
    </AuthShell>
  );
}
