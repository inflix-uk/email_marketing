import { redirect } from "next/navigation";
import { Sidebar } from "@/components/app-shell/sidebar";
import { RoleProvider } from "@/components/role-context";
import { endSession, requireSession } from "@/lib/auth";
import Link from "next/link";
import { getSettings, isDevMailer } from "@/lib/settings";

async function logout() {
  "use server";
  await endSession();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const devMailer = isDevMailer(await getSettings());

  return (
    <RoleProvider role={session.role}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar userEmail={session.email} logout={logout} />
        <div className="min-w-0 flex-1">
          {devMailer ? (
            <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs text-amber-900">
              Email sending isn&apos;t set up yet, so no emails will go out.{" "}
              <Link href="/settings" className="font-medium underline">
                Set it up
              </Link>
            </div>
          ) : null}
          {session.role === "viewer" ? (
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-2 text-xs text-slate-600">
              You can look around, but not change or send anything. Ask an admin if you need more.
            </div>
          ) : null}
          <main className="w-full px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </RoleProvider>
  );
}
