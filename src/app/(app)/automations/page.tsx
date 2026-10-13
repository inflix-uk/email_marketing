import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/form";
import { Card, PageHeader, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import { collections } from "@/db";
import { describeTrigger, formatDelay, getAutomationsStats, getEnrollmentCounts } from "@/lib/automations";
import { formatNumber, formatPercent } from "@/lib/utils";
import { AUTOMATION_EXAMPLES } from "./_lib/examples";
import { getTriggerNames } from "./_lib/queries";

export const metadata: Metadata = { title: "Automations" };

/** Automations are few; the list is not paginated. */
const MAX_ROWS = 200;

const ENROLMENT_NOTE =
  "Only people who join after an automation is activated are enrolled - existing contacts aren't emailed, and bulk imports or pasted lists don't trigger automations.";

export default async function AutomationsPage() {
  const { automations } = await collections();
  const docs = await automations
    .find(
      {},
      // Without the emails' HTML: only what the table shows.
      { projection: { name: 1, status: 1, trigger: 1, "steps.id": 1, "steps.delayMinutes": 1, updatedAt: 1 } },
    )
    .sort({ updatedAt: -1, _id: 1 })
    .limit(MAX_ROWS)
    .toArray();

  const newButton = <ButtonLink href="/automations/new">New automation</ButtonLink>;
  const header = (
    <PageHeader
      title="Automations"
      description="Emails that send themselves: a welcome email after sign-up, or a series spread over days."
      actions={newButton}
    />
  );

  if (docs.length === 0) {
    return (
      <>
        {header}
        <GettingStarted />
      </>
    );
  }

  const [names, counts, stats] = await Promise.all([
    getTriggerNames(docs.map((d) => d.trigger)),
    getEnrollmentCounts(docs.map((d) => d._id)),
    getAutomationsStats(docs),
  ]);

  return (
    <>
      {header}
      <Card className="overflow-hidden">
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Automation</Th>
              <Th>Starts when someone</Th>
              <Th>Status</Th>
              <Th className="text-right">In progress</Th>
              <Th className="text-right">Completed</Th>
              <Th className="text-right">Emails sent</Th>
            </tr>
          </thead>
          <TBody>
            {docs.map((a) => {
              const steps = a.steps ?? [];
              const people = counts.get(a._id);
              const sent = stats.get(a._id);
              const span = steps.slice(1).reduce((sum, s) => sum + (s.delayMinutes || 0), 0);
              return (
                <tr key={a._id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/automations/${a._id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                      {a.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {steps.length === 0
                        ? "No emails yet"
                        : steps.length === 1
                          ? "1 email"
                          : `${steps.length} emails${span > 0 ? ` over ${formatDelay(span)}` : ""}`}
                    </p>
                  </Td>
                  <Td>{describeTrigger(a.trigger, names)}</Td>
                  <Td>
                    <StatusBadge status={a.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(people?.active ?? 0)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(people?.completed ?? 0)}</Td>
                  <Td className="text-right tabular-nums">
                    {formatNumber(sent?.sent ?? 0)}
                    {sent && sent.sent > 0 ? (
                      <span className="block text-xs text-slate-500">{formatPercent(sent.opened, sent.sent)} opened</span>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </TBody>
        </Table>
      </Card>
      <p className="mt-4 text-xs text-slate-500">{ENROLMENT_NOTE}</p>
    </>
  );
}

function GettingStarted() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border-2 border-dashed border-slate-200 px-6 py-10 text-center">
        <h2 className="text-sm font-semibold text-slate-900">No automations yet</h2>
        <p className="mx-auto mt-1 max-w-xl text-sm text-slate-500">
          An automation sends emails on its own when something happens - someone joins a list, signs up through a
          form or gets a tag. Write the emails once; every new person receives them at the right moment.
        </p>
        <div className="mt-4 flex justify-center">
          <ButtonLink href="/automations/new">New automation</ButtonLink>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Start from an example</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {AUTOMATION_EXAMPLES.map((example) => (
            <Link
              key={example.key}
              href={`/automations/new?example=${example.key}`}
              className="group rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md hover:ring-indigo-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              <p className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">{example.name}</p>
              <p className="mt-1 text-sm text-slate-500">{example.description}</p>
              <p className="mt-3 text-xs font-medium text-slate-600">{example.summary}</p>
            </Link>
          ))}
        </div>
      </div>

      <Alert tone="info">{ENROLMENT_NOTE}</Alert>
    </div>
  );
}
