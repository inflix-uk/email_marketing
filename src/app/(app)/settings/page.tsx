import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/layout";
import { requireSession } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { getSettings, isDevMailer } from "@/lib/settings";
import { AccountForm, EmailProviderForm, SenderForm, SendingForm, TestEmailForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${className}`} />;
}

export default async function SettingsPage() {
  const session = await requireSession();
  const settings = await getSettings();
  const { smtp } = settings;
  const testMode = isDevMailer(settings);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="Changes apply straight away - no restart needed." />

      <div className="space-y-6">
        <Section
          title="Email provider"
          description={
            testMode ? (
              <>
                <Dot className="bg-amber-500" />
                Test mode - emails are saved to <code className="font-mono">data/outbox</code>
              </>
            ) : (
              <>
                <Dot className="bg-emerald-500" />
                Sending with <span className="font-mono">{smtp.host}</span>
              </>
            )
          }
        >
          <EmailProviderForm
            initial={{
              host: smtp.host,
              port: smtp.port,
              secure: smtp.secure,
              user: smtp.user,
              // Only whether one is saved - the password itself stays on the server.
              hasPassword: Boolean(smtp.host && smtp.pass),
            }}
          />
        </Section>

        <Section title="Sender" description="Default sender for new campaigns.">
          <SenderForm
            initial={{
              fromName: settings.fromName,
              fromEmail: settings.fromEmail,
              replyTo: settings.replyTo,
              companyAddress: settings.companyAddress,
            }}
          />
        </Section>

        <Section title="Sending">
          <SendingForm initial={{ appUrl: settings.appUrl, sendRatePerSecond: settings.sendRatePerSecond }} />
        </Section>

        <Section
          title="Send a test email"
          description={testMode ? "In test mode it is saved to data/outbox instead of sent." : "Uses the saved settings above."}
        >
          <TestEmailForm defaultTo={/@example\.(com|org|net)$/i.test(session.email) ? "" : session.email} />
        </Section>

        <Section title="Account" description="Your sign-in email and password.">
          <AccountForm email={session.email} minPasswordLength={MIN_PASSWORD_LENGTH} />
        </Section>
      </div>
    </div>
  );
}
