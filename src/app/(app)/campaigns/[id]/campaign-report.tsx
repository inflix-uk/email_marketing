import Link from "next/link";
import type { ReactNode } from "react";
import { EmailPreview } from "@/components/email-editor";
import { Alert } from "@/components/ui/form";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  StatusBadge,
  Table,
  TBody,
  Td,
  Th,
} from "@/components/ui/layout";
import type { AbTest, Campaign } from "@/db/schema";
import {
  getCampaignStats,
  getCampaignTimeline,
  getTopLinks,
  getVariantStats,
  type CampaignStats,
} from "@/lib/sending";
import { cn, formatDateTime, formatNumber, formatPercent } from "@/lib/utils";
import { cancelSending, duplicateCampaign, pauseSending, resendToNonOpeners, resumeSending } from "../actions";
import { ActionButton, ConfirmButton } from "../_components/action-buttons";
import { DownloadLink } from "../_components/download-link";
import { FilterTabs } from "../_components/filter-tabs";
import { Pagination } from "../_components/pagination";
import {
  getListNames,
  getRecipientsPage,
  getSegmentNames,
  RECIPIENT_FILTERS,
  RECIPIENTS_PAGE_SIZE,
  type RecipientFilter,
  type RecipientRow,
} from "../_lib/queries";
import { buildTimeline } from "../_lib/timeline";
import { AutoRefresh } from "./auto-refresh";
import { TimelineChart } from "./timeline-chart";

const FILTER_LABELS: Record<RecipientFilter, string> = {
  all: "All",
  opened: "Opened",
  clicked: "Clicked",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  failed: "Failed / skipped",
};

const FILTER_EMPTY: Record<RecipientFilter, string> = {
  all: "No recipients yet.",
  opened: "Nobody has opened this email yet.",
  clicked: "Nobody has clicked a link yet.",
  unsubscribed: "Nobody unsubscribed from this campaign.",
  bounced: "No bounced emails.",
  failed: "No failed or skipped emails.",
};

function filterCount(filter: RecipientFilter, stats: CampaignStats): number {
  switch (filter) {
    case "opened":
      return stats.opened;
    case "clicked":
      return stats.clicked;
    case "unsubscribed":
      return stats.unsubscribed;
    case "bounced":
      return stats.bounced;
    case "failed":
      return stats.failed + stats.skipped;
    default:
      return stats.total;
  }
}

/** /campaigns/[id] once a campaign has been queued: progress and results. */
export async function CampaignReport({
  campaign,
  filter,
  page,
}: {
  campaign: Campaign;
  filter: RecipientFilter;
  page: number;
}) {
  const [stats, topLinks, recipients, lists, segments, variants, buckets] = await Promise.all([
    getCampaignStats(campaign.id),
    getTopLinks(campaign.id, 10),
    getRecipientsPage(campaign.id, filter, page),
    getListNames(campaign.listIds ?? []),
    getSegmentNames(campaign.segmentIds ?? []),
    campaign.abTest ? getVariantStats(campaign.id) : null,
    getCampaignTimeline(campaign.id),
  ]);
  const timeline = buildTimeline(buckets, campaign.startedAt);
  const audience = [
    lists.length ? `${lists.length} ${lists.length === 1 ? "list" : "lists"}` : "",
    segments.length ? `${segments.length} ${segments.length === 1 ? "segment" : "segments"}` : "",
  ].filter(Boolean);

  const total = stats.total || campaign.totalRecipients;
  const processed = stats.sent + stats.failed + stats.skipped;
  const waiting = stats.queued + stats.sending;
  const inProgress = campaign.status === "sending" || campaign.status === "paused";

  const baseHref = `/campaigns/${campaign.id}`;
  const recipientsHref = (f: RecipientFilter, p = 1) => {
    const qs = new URLSearchParams();
    if (f !== "all") qs.set("filter", f);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `${baseHref}?${s}#recipients` : `${baseHref}#recipients`;
  };

  return (
    <>
      <PageHeader
        back={
          <Link href="/campaigns" className="font-medium text-slate-500 hover:text-slate-700">
            &larr; Campaigns
          </Link>
        }
        title={campaign.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={campaign.status} />
            <span>{statusLine(campaign)}</span>
          </span>
        }
        actions={
          <>
            {campaign.status === "sending" ? (
              <ActionButton action={pauseSending.bind(null, campaign.id)} pendingText="Pausing...">
                Pause
              </ActionButton>
            ) : null}
            {campaign.status === "paused" ? (
              <ActionButton action={resumeSending.bind(null, campaign.id)} variant="primary" pendingText="Resuming...">
                Resume sending
              </ActionButton>
            ) : null}
            {inProgress ? (
              <ConfirmButton
                action={cancelSending.bind(null, campaign.id)}
                label="Cancel"
                variant="ghost"
                title="Cancel this campaign?"
                description={
                  <p>
                    The {formatNumber(waiting)} emails that haven&apos;t gone out yet won&apos;t be sent. Emails already
                    delivered can&apos;t be recalled, and a cancelled campaign can&apos;t be restarted - duplicate it to
                    send again.
                  </p>
                }
                confirmLabel="Cancel campaign"
                dismissLabel="Keep campaign"
                pendingText="Cancelling..."
              />
            ) : null}
            {campaign.status === "sent" ? (
              <ActionButton action={resendToNonOpeners.bind(null, campaign.id)} pendingText="Creating draft...">
                Resend to non-openers
              </ActionButton>
            ) : null}
            <ActionButton action={duplicateCampaign.bind(null, campaign.id)} pendingText="Duplicating...">
              Duplicate
            </ActionButton>
          </>
        }
      />

      {campaign.pauseReason ? (
        <Alert tone="warning" className="mb-6">
          <strong className="font-semibold">Sending was paused automatically.</strong> {campaign.pauseReason}
          {campaign.status === "paused" ? " Check your list before you resume." : null}
        </Alert>
      ) : null}

      {inProgress ? (
        <Card className="mb-6">
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">
                {campaign.status === "paused" ? "Sending is paused" : "Sending in progress"}
              </p>
              {campaign.status === "sending" ? <AutoRefresh /> : null}
            </div>
            <div
              role="progressbar"
              aria-label="Sending progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={processed}
              aria-valuetext={`${formatNumber(processed)} of ${formatNumber(total)} processed`}
              className="h-2.5 overflow-hidden rounded-full bg-slate-100"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-700",
                  campaign.status === "paused" ? "bg-amber-500" : "bg-indigo-600",
                )}
                style={{ width: `${total ? Math.min(100, (processed / total) * 100) : 0}%` }}
              />
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-sm text-slate-600">
              <span>
                <strong className="font-semibold text-slate-900">{formatNumber(stats.sent)}</strong> of{" "}
                {formatNumber(total)} sent
                {stats.failed + stats.skipped ? ` · ${formatNumber(stats.failed + stats.skipped)} failed or skipped` : ""}
              </span>
              <span>{formatNumber(waiting)} waiting</span>
            </div>
            {campaign.status === "paused" ? (
              <p className="text-sm text-slate-500">No more emails go out until you resume.</p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {campaign.status === "cancelled" ? (
        <Alert tone="warning" className="mb-6">
          This campaign was cancelled. {formatNumber(stats.sent)} of {formatNumber(total)} emails were sent before it
          stopped.
        </Alert>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Recipients" value={formatNumber(total)} hint={audience.join(" · ") || undefined} />
        <Stat label="Delivered" value={formatNumber(stats.sent)} hint={`${formatPercent(stats.sent, total)} of recipients`} />
        <Stat
          label="Opens"
          value={formatPercent(stats.opened, stats.sent)}
          hint={`${formatNumber(stats.opened)} unique · ${formatNumber(stats.openCount)} total`}
        />
        <Stat
          label="Clicks"
          value={formatPercent(stats.clicked, stats.sent)}
          hint={`${formatNumber(stats.clicked)} unique · ${formatPercent(stats.clicked, stats.opened)} of opens`}
        />
        <Stat
          label="Unsubscribes"
          value={formatNumber(stats.unsubscribed)}
          hint={`${formatPercent(stats.unsubscribed, stats.sent)} of delivered`}
        />
        <Stat
          label="Bounced"
          value={formatNumber(stats.bounced)}
          hint={`${formatPercent(stats.bounced, stats.sent)} of delivered`}
        />
        <Stat
          label="Complaints"
          value={formatNumber(stats.complained)}
          hint={`${formatPercent(stats.complained, stats.sent)} marked it as spam`}
        />
        <Stat
          label="Failed / skipped"
          value={formatNumber(stats.failed + stats.skipped)}
          hint={`${formatNumber(stats.failed)} failed · ${formatNumber(stats.skipped)} skipped`}
        />
      </div>
      <p className="-mt-3 mb-6 text-xs text-slate-500">
        Rates are based on delivered emails. Open rates are approximate: some email apps block tracking images, others
        load them automatically.
      </p>

      {campaign.abTest ? <AbTestCard abTest={campaign.abTest} subjectA={campaign.subject} variants={variants} /> : null}

      <Card className="mb-6">
        <CardHeader
          title="Opens and clicks over time"
          description="First opens and link clicks per hour, for the first 72 hours after sending started."
        />
        <CardBody>
          {timeline.length ? (
            <TimelineChart points={timeline} />
          ) : (
            <p className="text-sm text-slate-500">No opens or clicks yet.</p>
          )}
        </CardBody>
      </Card>

      <Card className="mb-6 overflow-hidden">
        <CardHeader title="Top links" description="Tracked links in this email, by unique clicks." />
        {topLinks.length === 0 ? (
          <CardBody>
            <p className="text-sm text-slate-500">No link clicks yet.</p>
          </CardBody>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Link</Th>
                <Th className="text-right">Unique clicks</Th>
                <Th className="text-right">Total clicks</Th>
              </tr>
            </thead>
            <TBody>
              {topLinks.map((link) => (
                <tr key={link.url}>
                  <Td className="max-w-0 w-full">
                    {/^https?:\/\//i.test(link.url) ? (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={link.url}
                        className="block truncate text-indigo-600 hover:underline"
                      >
                        {link.url}
                      </a>
                    ) : (
                      <span className="block truncate" title={link.url}>
                        {link.url}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(link.uniqueClicks)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(link.clicks)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card id="recipients" className="mb-6 scroll-mt-6 overflow-hidden">
        <CardHeader
          title="Recipients"
          description="Everyone this campaign was queued for, and what they did."
          actions={
            stats.total > 0 ? (
              <DownloadLink href={`/api/campaigns/${campaign.id}/export`}>Export CSV</DownloadLink>
            ) : null
          }
        />
        <FilterTabs
          label="Filter recipients"
          className="px-3"
          tabs={RECIPIENT_FILTERS.map((f) => ({
            label: FILTER_LABELS[f],
            href: recipientsHref(f),
            active: f === filter,
            count: filterCount(f, stats),
          }))}
        />
        {recipients.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title={FILTER_EMPTY[filter]} />
          </div>
        ) : (
          <RecipientsTable rows={recipients.rows} />
        )}
        <Pagination
          page={recipients.page}
          pageCount={recipients.pageCount}
          pageSize={RECIPIENTS_PAGE_SIZE}
          total={recipients.total}
          hrefFor={(p) => recipientsHref(filter, p)}
        />
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Email" description="What recipients received. Merge tags are filled in with sample data here." />
        <div className="grid gap-6 p-5 lg:grid-cols-3">
          <dl className="space-y-4 text-sm">
            <Meta label={campaign.abTest ? "Subject A" : "Subject"}>{campaign.subject || "—"}</Meta>
            {campaign.abTest ? <Meta label="Subject B">{campaign.abTest.subjectB}</Meta> : null}
            {campaign.previewText ? <Meta label="Preview text">{campaign.previewText}</Meta> : null}
            <Meta label="From">
              {campaign.fromName} &lt;{campaign.fromEmail}&gt;
            </Meta>
            {campaign.replyTo ? <Meta label="Reply-to">{campaign.replyTo}</Meta> : null}
            <Meta label="Lists">{lists.length ? lists.map((l) => l.name).join(", ") : "—"}</Meta>
            {segments.length ? <Meta label="Segments">{segments.map((s) => s.name).join(", ")}</Meta> : null}
            <Meta label="Started">{formatDateTime(campaign.startedAt)}</Meta>
            <Meta label="Finished">{formatDateTime(campaign.completedAt)}</Meta>
          </dl>
          <div className="min-w-0 lg:col-span-2">
            <EmailPreview html={campaign.html} height={640} />
          </div>
        </div>
      </Card>
    </>
  );
}

function statusLine(campaign: Campaign): string {
  switch (campaign.status) {
    case "sending":
      return `Started ${formatDateTime(campaign.startedAt)}`;
    case "paused":
      return `Paused · started ${formatDateTime(campaign.startedAt)}`;
    case "sent":
      return `Sent ${formatDateTime(campaign.completedAt ?? campaign.startedAt)}`;
    case "cancelled":
      return `Cancelled ${formatDateTime(campaign.completedAt ?? campaign.updatedAt)}`;
    default:
      return "";
  }
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-slate-900">{children}</dd>
    </div>
  );
}

/** A vs B results of the subject-line test, and the winner once it's decided. */
function AbTestCard({
  abTest,
  subjectA,
  variants,
}: {
  abTest: AbTest;
  subjectA: string;
  variants: { A: CampaignStats; B: CampaignStats } | null;
}) {
  const rows = [
    { variant: "A" as const, subject: subjectA },
    { variant: "B" as const, subject: abTest.subjectB },
  ];
  const rest = 100 - abTest.testPercent;
  let summary: string;
  if (abTest.winner) {
    summary = `Subject ${abTest.winner} won on open rate${abTest.decidedAt ? ` (decided ${formatDateTime(abTest.decidedAt)})` : ""}${
      rest > 0 ? ` and went to the remaining ${rest}% of recipients.` : "."
    }`;
  } else if (rest > 0) {
    summary = `${abTest.testPercent}% of recipients are in the test. The subject with the better open rate after ${abTest.waitHours} ${
      abTest.waitHours === 1 ? "hour" : "hours"
    } goes to the remaining ${rest}%.`;
  } else {
    summary = "Everyone is in the test: half got subject A, half got subject B.";
  }

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title="A/B subject test" description={summary} />
      <Table>
        <thead className="bg-slate-50">
          <tr>
            <Th>Subject</Th>
            <Th className="text-right">Sent</Th>
            <Th className="text-right">Open rate</Th>
            <Th className="text-right">Click rate</Th>
          </tr>
        </thead>
        <TBody>
          {rows.map((row) => {
            const stats = variants?.[row.variant];
            return (
              <tr key={row.variant}>
                <Td className="max-w-0 w-full">
                  <span className="flex items-center gap-2">
                    <span className="shrink-0 font-semibold text-slate-900">{row.variant}</span>
                    <span className="truncate" title={row.subject}>
                      {row.subject || "—"}
                    </span>
                    {abTest.winner === row.variant ? <Badge tone="green">Winner</Badge> : null}
                  </span>
                </Td>
                <Td className="text-right tabular-nums">{stats ? formatNumber(stats.sent) : "—"}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">
                  {stats ? formatPercent(stats.opened, stats.sent) : "—"}
                </Td>
                <Td className="whitespace-nowrap text-right tabular-nums">
                  {stats ? formatPercent(stats.clicked, stats.sent) : "—"}
                </Td>
              </tr>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

function RecipientsTable({ rows }: { rows: RecipientRow[] }) {
  const showErrors = rows.some((r) => r.lastError && (r.status === "failed" || r.status === "skipped"));
  const showVariant = rows.some((r) => r.variant);
  return (
    <Table>
      <thead className="bg-slate-50">
        <tr>
          <Th>Email</Th>
          <Th>Status</Th>
          {showVariant ? <Th>Subject</Th> : null}
          <Th>Sent</Th>
          <Th>Opened</Th>
          <Th>Clicked</Th>
          {showErrors ? <Th>Error</Th> : null}
        </tr>
      </thead>
      <TBody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td className="max-w-64">
              <Link href={`/contacts/${row.contactId}`} className="block truncate font-medium text-slate-900 hover:text-indigo-600">
                {row.email}
              </Link>
            </Td>
            <Td>
              <span className="inline-flex flex-wrap gap-1">
                <StatusBadge status={row.status} />
                {row.bouncedAt ? <StatusBadge status="bounced" /> : null}
                {row.complainedAt ? <Badge tone="red">spam complaint</Badge> : null}
                {row.unsubscribedAt ? <StatusBadge status="unsubscribed" /> : null}
              </span>
            </Td>
            {showVariant ? <Td>{row.variant ?? <span className="text-slate-400">—</span>}</Td> : null}
            <Td className="whitespace-nowrap">{formatDateTime(row.sentAt)}</Td>
            <Td className="whitespace-nowrap">
              <When date={row.openedAt} count={row.openCount} />
            </Td>
            <Td className="whitespace-nowrap">
              <When date={row.clickedAt} count={row.clickCount} />
            </Td>
            {showErrors ? (
              <Td className="max-w-xs">
                {row.status === "failed" || row.status === "skipped" ? (
                  <span className="line-clamp-2 text-xs text-red-700" title={row.lastError ?? undefined}>
                    {row.lastError ?? "—"}
                  </span>
                ) : null}
              </Td>
            ) : null}
          </tr>
        ))}
      </TBody>
    </Table>
  );
}

/** First time something happened, plus how many times in total. */
function When({ date, count }: { date: Date | null; count: number }) {
  if (!date) return <span className="text-slate-400">—</span>;
  return (
    <>
      {formatDateTime(date)}
      {count > 1 ? <span className="ml-1 text-xs text-slate-500">({formatNumber(count)}×)</span> : null}
    </>
  );
}
