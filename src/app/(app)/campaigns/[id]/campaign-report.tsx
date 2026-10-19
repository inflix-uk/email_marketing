import Link from "next/link";
import { EmailPreview } from "@/components/email-editor";
import { Alert } from "@/components/ui/form";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import type { Campaign } from "@/db/schema";
import { getCampaignStats, type CampaignStats } from "@/lib/sending";
import { cn, formatDateTime, formatNumber, formatPercent } from "@/lib/utils";
import { cancelSending, duplicateCampaign, pauseSending, resumeSending } from "../actions";
import { ActionButton, ConfirmButton } from "../_components/action-buttons";
import { DownloadLink } from "../_components/download-link";
import { FilterTabs } from "../_components/filter-tabs";
import { Pagination } from "../_components/pagination";
import { displaySubject } from "../_lib/display";
import {
  getListNames,
  getRecipientsPage,
  RECIPIENT_FILTERS,
  RECIPIENTS_PAGE_SIZE,
  type RecipientFilter,
  type RecipientRow,
} from "../_lib/queries";
import { AutoRefresh } from "./auto-refresh";

const FILTER_LABELS: Record<RecipientFilter, string> = {
  all: "All",
  opened: "Opened",
  clicked: "Clicked",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  failed: "Not sent",
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
export async function CampaignReport({ campaign, filter, page }: { campaign: Campaign; filter: RecipientFilter; page: number }) {
  const [stats, recipients, lists] = await Promise.all([
    getCampaignStats(campaign.id),
    getRecipientsPage(campaign.id, filter, page),
    getListNames(campaign.listIds ?? []),
  ]);

  const total = stats.total || campaign.totalRecipients;
  const processed = stats.sent + stats.failed + stats.skipped;
  const inProgress = campaign.status === "sending" || campaign.status === "paused";

  const baseHref = `/campaigns/${campaign.id}`;
  const recipientsHref = (f: RecipientFilter, p = 1) => {
    const qs = new URLSearchParams();
    if (f !== "all") qs.set("filter", f);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `${baseHref}?${s}#recipients` : `${baseHref}#recipients`;
  };
  // Only show filters that have someone in them (plus All).
  const filters = RECIPIENT_FILTERS.filter((f) => f === "all" || f === filter || filterCount(f, stats) > 0);

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
            <StatusBadge status={campaign.status} />
            <span>{statusLine(campaign)}</span>
            {lists.length ? <span>· {lists.map((l) => l.name).join(", ")}</span> : null}
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
                Resume
              </ActionButton>
            ) : null}
            {inProgress ? (
              <ConfirmButton
                action={cancelSending.bind(null, campaign.id)}
                label="Stop"
                variant="ghost"
                title="Stop sending?"
                description={<p>Emails that haven&apos;t gone out yet won&apos;t be sent.</p>}
                confirmLabel="Stop sending"
                dismissLabel="Keep sending"
                pendingText="Stopping..."
              />
            ) : null}
            <ActionButton action={duplicateCampaign.bind(null, campaign.id)} pendingText="Copying...">
              Send again
            </ActionButton>
          </>
        }
      />

      {campaign.pauseReason ? (
        <Alert tone="warning" className="mb-6">
          Sending was paused automatically: {campaign.pauseReason}
        </Alert>
      ) : null}

      {inProgress ? (
        <Card className="mb-6">
          <CardBody className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-slate-900">
                {campaign.status === "paused" ? "Paused" : "Sending"} · {formatNumber(stats.sent)} of {formatNumber(total)} sent
              </span>
              {campaign.status === "sending" ? <AutoRefresh /> : null}
            </div>
            <div
              role="progressbar"
              aria-label="Sending progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={processed}
              className="h-2 overflow-hidden rounded-full bg-slate-100"
            >
              <div
                className={cn("h-full rounded-full transition-[width] duration-700", campaign.status === "paused" ? "bg-amber-500" : "bg-indigo-600")}
                style={{ width: `${total ? Math.min(100, (processed / total) * 100) : 0}%` }}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Sent" value={formatNumber(stats.sent)} hint={`of ${formatNumber(total)}`} />
        <Stat label="Opened" value={formatPercent(stats.opened, stats.sent)} hint={`${formatNumber(stats.opened)} people`} />
        <Stat label="Clicked" value={formatPercent(stats.clicked, stats.sent)} hint={`${formatNumber(stats.clicked)} people`} />
        <Stat label="Unsubscribed" value={formatNumber(stats.unsubscribed)} />
        <Stat label="Bounced" value={formatNumber(stats.bounced)} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-5">
        <Card id="recipients" className="scroll-mt-6 overflow-hidden xl:col-span-3">
          <CardHeader
            title="Recipients"
            actions={stats.total > 0 ? <DownloadLink href={`/api/campaigns/${campaign.id}/export`}>Export</DownloadLink> : null}
          />
          <FilterTabs
            label="Filter recipients"
            className="px-3"
            tabs={filters.map((f) => ({
              label: FILTER_LABELS[f],
              href: recipientsHref(f),
              active: f === filter,
              count: filterCount(f, stats),
            }))}
          />
          {recipients.rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Nobody here yet." />
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

        <Card className="overflow-hidden xl:sticky xl:top-6 xl:col-span-2">
          <div className="border-b border-slate-200 px-4 py-2.5 text-sm">
            <p className="truncate font-medium text-slate-900">{displaySubject(campaign.subject)}</p>
            <p className="truncate text-xs text-slate-500">
              From {campaign.fromName} &lt;{campaign.fromEmail}&gt;
            </p>
          </div>
          <EmailPreview html={campaign.html} height={620} />
        </Card>
      </div>
    </>
  );
}

function statusLine(campaign: Campaign): string {
  switch (campaign.status) {
    case "sending":
    case "paused":
      return `Started ${formatDateTime(campaign.startedAt)}`;
    case "sent":
      return `Sent ${formatDateTime(campaign.completedAt ?? campaign.startedAt)}`;
    case "cancelled":
      return `Stopped ${formatDateTime(campaign.completedAt ?? campaign.updatedAt)}`;
    default:
      return "";
  }
}

function RecipientsTable({ rows }: { rows: RecipientRow[] }) {
  return (
    <Table>
      <thead className="bg-slate-50">
        <tr>
          <Th>Email</Th>
          <Th>Status</Th>
          <Th>Opened</Th>
          <Th>Clicked</Th>
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
              <span className="inline-flex flex-wrap gap-1" title={row.lastError ?? undefined}>
                <StatusBadge status={row.status} />
                {row.bouncedAt ? <StatusBadge status="bounced" /> : null}
                {row.unsubscribedAt ? <StatusBadge status="unsubscribed" /> : null}
              </span>
            </Td>
            <Td className="whitespace-nowrap">{row.openedAt ? formatDateTime(row.openedAt) : <span className="text-slate-400">—</span>}</Td>
            <Td className="whitespace-nowrap">{row.clickedAt ? formatDateTime(row.clickedAt) : <span className="text-slate-400">—</span>}</Td>
          </tr>
        ))}
      </TBody>
    </Table>
  );
}
