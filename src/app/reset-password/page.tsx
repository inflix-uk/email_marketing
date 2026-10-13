import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { checkPasswordLink } from "@/lib/auth";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { getSetupState } from "@/lib/setup";
import { AuthShell } from "../login/auth-shell";
import { LinkExpired, ResetPasswordForm } from "./reset-password-form";

// The address contains a one-time secret: keep it out of search engines and Referer headers.
export const metadata: Metadata = { title: "Choose a password", robots: { index: false }, referrer: "no-referrer" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token: rawToken } = await searchParams;
  if ((await getSetupState()).step !== "done") redirect("/setup");

  // Opening the page doesn't use the link up (email scanners open links too) - only saving a password does.
  const token = typeof rawToken === "string" ? rawToken : "";
  const account = token ? await checkPasswordLink(token) : null;

  const footer = (
    <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
      &larr; Back to sign in
    </Link>
  );

  if (!account) {
    return (
      <AuthShell title="Link expired" footer={footer}>
        <LinkExpired />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={account.isNewAccount ? "Set your password" : "Choose a new password"}
      description={
        <>
          For <span className="font-medium text-slate-700">{account.email}</span>.
          {account.isNewAccount ? null : " You'll be signed out on your other devices."}
        </>
      }
      footer={footer}
    >
      <ResetPasswordForm
        token={token}
        email={account.email}
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
      />
    </AuthShell>
  );
}
