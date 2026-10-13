import type { Metadata } from "next";
import type { ComponentProps } from "react";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Stat } from "@/components/ui/layout";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import { Audience } from "./_dashboard/audience";
import { getDashboardData, STATS_WINDOW_DAYS } from "./_dashboard/data";
import { GetStarted, type ChecklistStep } from "./_dashboard/get-started";
import { RecentCampaigns } from "./_dashboard/recent-campaigns";

export const metadata: Metadata = { title: "Dashboard" };

/** A UI-kit Stat that fills its grid cell (so tiles in a row share a height). */
function Tile({ className, ...props }: ComponentProps<typeof Stat> & { className?: string }) {
  return (
    <div className={cn("[&>div]:h-full", className)}>
      <Stat {...props} />
    </div>
  );
}

export default async function DashboardPage() {
  const data = await getDashboardData();
  const { contacts, window } = data;
  const windowLabel = `Last ${STATS_WINDOW_DAYS} days`;

  const steps: ChecklistStep[] = [
    {
      label: "Configure sending",
      description:
        "Connect an email provider (Amazon SES, Resend, Brevo...) and set your sender address. Until then emails are saved to data/outbox.",
      href: "/settings",
      cta: "Open settings",
      done: data.sendingConfigured,
    },
    {
      label: "Add contacts",
      description: "Import a CSV of people who have agreed to hear from you.",
      href: "/contacts/import",
      cta: "Import contacts",
      done: contacts.total > 0,
    },
    {
      label: "Create a list",
      description: "Group contacts (e.g. Newsletter, Customers) so you can target campaigns.",
      href: "/lists",
      cta: "Create a list",
      done: data.listCount > 0,
    },
    {
      label: "Create a template",
      description: "Start from a ready-made design and add your branding.",
      href: "/templates/new",
      cta: "Create a template",
      done: data.templateCount > 0,
    },
    {
      label: "Send your first campaign",
      description: "Pick a template and a list, send yourself a test, then send it.",
      href: data.campaignCount > 0 ? "/campaigns" : "/campaigns/new",
      cta: data.campaignCount > 0 ? "Go to campaigns" : "New campaign",
      done: data.everSentCount > 0,
    },
  ];
  const showChecklist = steps.some((s) => !s.done);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="An overview of your audience and recent campaigns."
        actions={
          <>
            <ButtonLink href="/contacts/import" variant="secondary">
              Import contacts
            </ButtonLink>
            <ButtonLink href="/campaigns/new">New campaign</ButtonLink>
          </>
        }
      />

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <Tile
          className="col-span-2 xl:col-span-1"
          label="Subscribed contacts"
          value={formatNumber(contacts.subscribed)}
          hint={`of ${formatNumber(contacts.total)} total`}
        />
        <Tile
          label="Lists"
          value={formatNumber(data.listCount)}
          hint={`${formatNumber(data.templateCount)} ${data.templateCount === 1 ? "template" : "templates"}`}
        />
        <Tile
          label="Campaigns sent"
          value={formatNumber(window.campaigns)}
          hint={data.sendingNow ? `${windowLabel} · ${data.sendingNow} sending now` : windowLabel}
        />
        <Tile
          label="Avg. open rate"
          value={window.sent ? formatPercent(window.opened, window.sent) : "—"}
          hint={window.sent ? `${formatNumber(window.sent)} emails sent · ${windowLabel.toLowerCase()}` : `No sends in the ${windowLabel.toLowerCase()}`}
        />
        <Tile
          label="Avg. click rate"
          value={window.sent ? formatPercent(window.clicked, window.sent) : "—"}
          hint={window.sent ? `${formatNumber(window.clicked)} people clicked a link` : `No sends in the ${windowLabel.toLowerCase()}`}
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="min-w-0 lg:col-span-2 lg:row-span-2">
          <RecentCampaigns campaigns={data.recent} />
        </div>
        {showChecklist ? (
          // On small screens the checklist comes first: it's the next thing to do.
          <div className="order-first lg:order-none lg:col-start-3">
            <GetStarted steps={steps} />
          </div>
        ) : null}
        <div className="lg:col-start-3">
          <Audience contacts={contacts} />
        </div>
      </div>
    </>
  );
}
