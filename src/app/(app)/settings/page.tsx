import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/layout";
import { collections } from "@/db";
import { listTeam, requireSession } from "@/lib/auth";
import { getSettings, isDevMailer } from "@/lib/settings";
import { AccountForm, EmailSendingForm, SenderForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

const LOCAL_URL = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

/** The address this page was opened on, e.g. https://mail.example.com ("" if unknown). */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!host) return "";
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || (LOCAL_URL.test(host) ? "http" : "https");
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return "";
  }
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${className}`} />;
}

export default async function SettingsPage() {
  const session = await requireSession();
  const { settings: settingsCollection } = await collections();
  const [settings, stored, team, origin] = await Promise.all([
    getSettings(),
    settingsCollection.findOne({ _id: "app" }, { projection: { appUrl: 1 } }),
    listTeam(),
    requestOrigin(),
  ]);
  const { smtp } = settings;
  const notSetUp = isDevMailer(settings);

  // Website address: suggest this page's address when none is stored yet (or the
  // stored one is a localhost address while the app is opened on a real domain).
  const storedUrl = stored?.appUrl?.trim() ?? "";
  const suggest = Boolean(origin) && (!storedUrl || (LOCAL_URL.test(storedUrl) && !LOCAL_URL.test(origin)));
  const appUrl = suggest ? origin : storedUrl || settings.appUrl;

  return (
    <>
      <PageHeader title="Settings" />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Email sending"
            description={
              notSetUp ? (
                <>
                  <Dot className="bg-amber-500" />
                  Not set up yet - emails won&apos;t be sent until you add your email provider.
                </>
              ) : (
                <>
                  <Dot className="bg-emerald-500" />
                  Sending through <span className="font-medium text-slate-700">{smtp.host}</span>
                </>
              )
            }
          />
          <CardBody>
            <EmailSendingForm
              initial={{
                host: smtp.host,
                port: smtp.port,
                secure: smtp.secure,
                user: smtp.user,
                // Only whether one is saved - the password itself stays on the server.
                hasPassword: Boolean(smtp.host && smtp.pass),
              }}
              testTo={/@example\.(com|org|net)$/i.test(session.email) ? "" : session.email}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sender" />
          <CardBody>
            <SenderForm
              initial={{
                fromName: settings.fromName,
                fromEmail: settings.fromEmail,
                companyAddress: settings.companyAddress,
                appUrl,
              }}
              appUrlSaved={!suggest}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Account" />
          <CardBody>
            <AccountForm email={session.email} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Team"
            actions={
              <Link href="/settings/team" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
                Manage team
              </Link>
            }
          />
          <CardBody>
            <ul className="space-y-1.5 text-sm text-slate-700">
              {team.slice(0, 5).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <span className="truncate">{m.email}</span>
                  {m.email === session.email ? <Badge tone="indigo">You</Badge> : null}
                  {m.pending ? <Badge tone="yellow">Invited</Badge> : null}
                </li>
              ))}
              {team.length > 5 ? <li className="text-slate-500">and {team.length - 5} more</li> : null}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
