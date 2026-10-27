import Link from "next/link";
import { Can } from "@/components/role-context";
import { Alert } from "@/components/ui/form";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import type { Campaign } from "@/db/schema";
import { getChildRuns } from "@/lib/campaign-types/reports";
import { describeSchedule } from "@/lib/campaign-types/rss-schedule";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/utils";
import { cancelSending, pauseSending, resumeSending } from "../actions";
import { displaySubject } from "../_lib/display";
import { checkSeriesNow } from "../type-actions";
import { ActionButton, ConfirmButton } from "./action-buttons";
import { LocalDateTime } from "./local-time";

/** /campaigns/[id] for an RSS series once started: its schedule, feed status and runs. */
export async function RssSeriesPage({ campaign }: { campaign: Campaign }) {
  const rss = campaign.rss!;
  const runs = await getChildRuns(campaign.id);
  const active = campaign.status === "sending";
  const paused = campaign.status === "paused";
  const state = active ? (
    <Badge tone="green">Active</Badge>
  ) : paused ? (
    <Badge tone="yellow">Paused</Badge>
  ) : campaign.status === "cancelled" ? (
    <Badge tone="gray">Stopped</Badge>
  ) : (
    <StatusBadge status={campaign.status} />
  );

  return (
    <>
      <PageHeader
        back={
          <Link href="/campaigns" className="font-medium text-slate-500 hover:text-slate-700">
            &larr; Campaigns
          </Link>
        }
        title={displaySubject(campaign.subject) || campaign.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {state}
            <span>RSS · {describeSchedule(rss)}</span>
          </span>
        }
        actions={
          <Can permission="send">
            {active ? (
              <ActionButton action={checkSeriesNow.bind(null, campaign.id)} pendingText="Checking...">
                Check feed now
              </ActionButton>
            ) : null}
            {active ? (
              <ActionButton action={pauseSending.bind(null, campaign.id)} pendingText="Pausing...">
                Pause
              </ActionButton>
            ) : null}
            {paused ? (
              <ActionButton action={resumeSending.bind(null, campaign.id)} variant="primary" pendingText="Resuming...">
                Resume
              </ActionButton>
            ) : null}
            {active || paused ? (
              <ConfirmButton
                action={cancelSending.bind(null, campaign.id)}
                label="Stop series"
                variant="ghost"
                title="Stop this series?"
                description={<p>No more emails will be sent from this feed. Emails already sent stay in the list below.</p>}
                confirmLabel="Stop series"
                dismissLabel="Keep it"
                pendingText="Stopping..."
              />
            ) : null}
          </Can>
        }
      />

      {rss.lastError ? (
        <Alert tone="error" className="mb-6">
          Feed problem: {rss.lastError}
        </Alert>
      ) : null}

      <Card className="mb-6">
        <CardBody>
          <dl className="grid gap-4 text-sm sm:grid-cols-4">
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Feed</dt>
              <dd className="truncate font-medium text-slate-900">
                <a href={rss.feedUrl} target="_blank" rel="noreferrer noopener" className="hover:text-indigo-600">
                  {rss.feedUrl}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Next check</dt>
              <dd className="font-medium text-slate-900">
                {active && rss.nextRunAt ? <LocalDateTime value={rss.nextRunAt.toISOString()} /> : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Last checked</dt>
              <dd className="font-medium text-slate-900">{rss.lastCheckedAt ? <LocalDateTime value={rss.lastCheckedAt.toISOString()} /> : "Not yet"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Up to {rss.itemCount} new {rss.itemCount === 1 ? "post" : "posts"} per email. When there are no new posts, no email is
            sent.
          </p>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Emails sent" description={`${formatNumber(rss.runCount ?? runs.length)} so far`} />
        {runs.length === 0 ? (
          <CardBody>
            <EmptyState title="Nothing sent yet" description="The first email goes out at the next check if the feed has posts." />
          </CardBody>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th className="text-right">Sent</Th>
                <Th className="text-right">Opened</Th>
                <Th className="text-right">Clicked</Th>
              </tr>
            </thead>
            <TBody>
              {runs.map((run) => (
                <tr key={run.id} className="relative hover:bg-slate-50">
                  <Td>
                    <Link
                      href={`/campaigns/${run.id}`}
                      className="font-medium text-slate-900 after:absolute after:inset-0 hover:text-indigo-600"
                    >
                      {formatDateTime(run.createdAt)}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={run.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(run.stats.sent)}</Td>
                  <Td className="text-right tabular-nums">{formatPercent(run.stats.opened, run.stats.sent)}</Td>
                  <Td className="text-right tabular-nums">{formatPercent(run.stats.clicked, run.stats.sent)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
