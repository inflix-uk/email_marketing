import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/form";
import { PageHeader, Stat, StatusBadge } from "@/components/ui/layout";
import { describeTrigger, getEnrollmentCounts, getStepStats, getWaitingByStep } from "@/lib/automations";
import { formatNumber, formatPercent } from "@/lib/utils";
import { deleteAutomation, pauseAutomation } from "../actions";
import { ActionButton, ConfirmButton } from "../_components/action-buttons";
import { AutomationForm, type AutomationDefaults, type StepNumbers } from "../_components/automation-form";
import { getAutomation, getTriggerNames, getTriggerOptions } from "../_lib/queries";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const automation = await getAutomation((await params).id);
  return { title: automation?.name ?? "Automation not found" };
}

export default async function AutomationPage({ params }: { params: Params }) {
  const { id } = await params;
  const automation = await getAutomation(id);
  if (!automation) notFound();

  const steps = automation.steps ?? [];
  const [options, names, countsById, statsByStep, waiting] = await Promise.all([
    getTriggerOptions(),
    getTriggerNames([automation.trigger]),
    getEnrollmentCounts([automation.id]),
    getStepStats({ _id: automation.id, steps }),
    getWaitingByStep(automation.id),
  ]);
  const people = countsById.get(automation.id) ?? { active: 0, completed: 0, stopped: 0, total: 0 };

  const stepStats: Record<string, StepNumbers> = {};
  const totals = { sent: 0, opened: 0, clicked: 0 };
  steps.forEach((step, index) => {
    const s = statsByStep.get(step.id);
    stepStats[step.id] = {
      sent: s?.sent ?? 0,
      opened: s?.opened ?? 0,
      clicked: s?.clicked ?? 0,
      failed: s?.failed ?? 0,
      waiting: waiting.get(index) ?? 0,
    };
    totals.sent += s?.sent ?? 0;
    totals.opened += s?.opened ?? 0;
    totals.clicked += s?.clicked ?? 0;
  });

  const defaults: AutomationDefaults = {
    name: automation.name,
    trigger: automation.trigger ?? null,
    fromName: automation.fromName ?? "",
    fromEmail: automation.fromEmail ?? "",
    replyTo: automation.replyTo ?? "",
    steps: steps.map((s) => ({
      id: s.id,
      delayMinutes: s.delayMinutes ?? 0,
      subject: s.subject ?? "",
      previewText: s.previewText ?? "",
      html: s.html ?? "",
      design: s.design ?? null,
    })),
  };

  return (
    <>
      <PageHeader
        back={
          <Link href="/automations" className="font-medium text-slate-500 hover:text-slate-700">
            &larr; Automations
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {automation.name}
            <StatusBadge status={automation.status} />
          </span>
        }
        description={`Starts when someone: ${describeTrigger(automation.trigger, names).replace(/^./, (c) => c.toLowerCase())}`}
        actions={
          <>
            {automation.status === "active" ? (
              <ActionButton action={pauseAutomation.bind(null, automation.id)} pendingText="Pausing...">
                Pause
              </ActionButton>
            ) : null}
            <ConfirmButton
              action={deleteAutomation.bind(null, automation.id)}
              label="Delete"
              className="text-red-700"
              title={`Delete "${automation.name}"?`}
              description={
                <>
                  <p>
                    The automation and its emails are removed
                    {people.active > 0
                      ? `, and the ${formatNumber(people.active)} ${people.active === 1 ? "person" : "people"} still in the series won't receive the remaining emails`
                      : ""}
                    . This can&apos;t be undone.
                  </p>
                  <p className="mt-2">Emails that were already sent keep working: their links and unsubscribe pages are not affected.</p>
                </>
              }
              confirmLabel="Delete automation"
              pendingText="Deleting..."
            />
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="In progress" value={formatNumber(people.active)} hint="Waiting for their next email" />
        <Stat label="Completed" value={formatNumber(people.completed)} hint="Went through the whole series" />
        <Stat label="Stopped early" value={formatNumber(people.stopped)} hint="Unsubscribed, bounced or deleted" />
        <Stat
          label="Emails sent"
          value={formatNumber(totals.sent)}
          hint={
            totals.sent > 0
              ? `${formatPercent(totals.opened, totals.sent)} opened · ${formatPercent(totals.clicked, totals.sent)} clicked`
              : "Nothing sent yet"
          }
        />
      </div>

      <Alert tone={automation.status === "paused" ? "warning" : "info"} className="mb-6">
        {automation.status === "draft" ? (
          <>
            <strong>Draft.</strong> Nothing is sent yet. Use &quot;Save &amp; activate&quot; when the emails are ready.{" "}
          </>
        ) : automation.status === "paused" ? (
          <>
            <strong>Paused.</strong> No emails are sent and nobody new is enrolled. People already in the series keep
            their place and continue when you resume.{" "}
          </>
        ) : (
          <>
            <strong>Active.</strong> Each person goes through the series once.{" "}
          </>
        )}
        Only people who join <strong>after</strong> activation are enrolled - existing contacts aren&apos;t emailed.
        Bulk imports and pasted lists don&apos;t trigger automations.
      </Alert>

      <AutomationForm
        automationId={automation.id}
        status={automation.status}
        defaults={defaults}
        options={options}
        stepStats={stepStats}
      />
    </>
  );
}
