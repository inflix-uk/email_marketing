import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getSetupState } from "@/lib/setup";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  if ((await getSetupState()).step !== "done") redirect("/setup");
  if (await getSession()) redirect("/");

  return (
    <AuthShell title="Sign in">
      <LoginForm next={typeof next === "string" ? next : "/"} />
    </AuthShell>
  );
}
