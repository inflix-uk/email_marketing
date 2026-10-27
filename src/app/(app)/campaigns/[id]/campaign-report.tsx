import Link from "next/link";
import { Can } from "@/components/role-context";
import { Alert } from "@/components/ui/form";
import { Card, CardBody, PageHeader, StatusBadge } from "@/components/ui/layout";
import type { Campaign } from "@/db/schema";
import { getReportSummary } from "@/lib/reports/campaign";
import { formatUkDateTime } from "@/lib/reports/time-buckets";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import { cancelSending, deleteCampaign, duplicateCampaign, pauseSending, resumeSending } from "../actions";
import { ActionButton, ConfirmButton } from "../_components/action-buttons";
import { FilterTabs } from "../_components/filter-tabs";
import { CampaignTypeResults } from "../_components/type-results";
import { displaySubject } from "../_lib/display";
import { getListNames } from "../_lib/queries";
import { AutoRefresh } from "./auto-refresh";
import { PrintButton } from "./print-button";
import { ReportClickMap } from "./report-click-map";
import { ReportDevices } from "./report-devices";
import { ReportLinks } from "./report-links";
import { ReportOverview } from "./report-overview";
import { ReportRecipients } from "./report-recipients";
import { REPORT_TAB_LABELS, REPORT_TABS, reportHref, type ReportState } from "./report-state";

/** /campaigns/[id] once a campaign has been queued: progress and results, in tabs (?tab=). */
export async function CampaignReport({ campaign, state }: { campaign: Campaign; state: ReportState }) {
  const options = { hideBots: state.hideBots };
  const [summary, lists] = await Promise.all([
    getReportSummary(campaign.id, options),
    getListNames(campaign.listIds ?? []),
  ]);

  const total = summary.total || campaign.totalRecipients;
  const processed = summary.sent + summary.filters.failed;
  const inProgress = campaign.status === "sending" || campaign.status === "paused";
  const updatedAt = new Date();

  return (
    <div data-print-report>
      <PageHeader
        back={
          <Link href="/campaigns" className="font-medium text-slate-500 hover:text-slate-700 print:hidden">
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
          <div className="flex flex-wrap items-center gap-2 print:hidden">
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
            <Can permission="edit">
            <ActionButton action={duplicateCampaign.bind(null, campaign.id)} pendingText="Copying...">
              Send again
            </ActionButton>
            </Can>
            <PrintButton />
            {campaign.status === "sent" || campaign.status === "cancelled" ? (
              <ConfirmButton
                action={deleteCampaign.bind(null, campaign.id)}
                label="Delete"
                variant="ghost"
                title="Delete this campaign?"
                description={<p>Its results are deleted too. Your contacts stay as they are.</p>}
                confirmLabel="Delete"
                pendingText="Deleting..."
              />
            ) : null}
          </div>
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
                {campaign.status === "paused" ? "Paused" : "Sending"} · {formatNumber(summary.sent)} of {formatNumber(total)} sent
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

      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <FilterTabs
          label="Report sections"
          className="min-w-0 flex-1 print:hidden"
          tabs={REPORT_TABS.map((tab) => ({
            label: REPORT_TAB_LABELS[tab],
            href: reportHref(state, { tab, page: 1, sendId: null }),
            active: tab === state.tab,
          }))}
        />
        <div className="flex flex-wrap items-center gap-3 pb-2 text-xs text-slate-500">
          {inProgress ? (
            <span
              className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20"
              title="Still sending: these numbers will change."
            >
              Running · numbers will change
            </span>
          ) : null}
          <span title="Times on this page are UK time (Europe/London).">Last updated {formatUkDateTime(updatedAt)} UK time</span>
          <Link
            href={reportHref(state, { hideBots: !state.hideBots, page: 1 })}
            scroll={false}
            className="inline-flex items-center gap-1.5 font-medium text-slate-600 hover:text-slate-900 print:hidden"
            title="Leaves out link scanners, clicks within 2 seconds of sending and Apple Mail's automatic opens."
            aria-pressed={state.hideBots}
          >
            <span
              aria-hidden
              className={cn(
                "inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
                state.hideBots ? "bg-indigo-600" : "bg-slate-300",
              )}
            >
              <span className={cn("h-3 w-3 rounded-full bg-white transition-transform", state.hideBots && "translate-x-3")} />
            </span>
            Hide suspected bots
          </Link>
        </div>
      </div>

      {state.tab === "overview" ? <CampaignTypeResults campaign={campaign} /> : null}
      {state.tab === "overview" ? <ReportOverview campaign={campaign} state={state} summary={summary} /> : null}
      {state.tab === "recipients" ? <ReportRecipients campaign={campaign} state={state} summary={summary} /> : null}
      {state.tab === "links" ? <ReportLinks campaign={campaign} state={state} /> : null}
      {state.tab === "click-map" ? <ReportClickMap campaign={campaign} state={state} /> : null}
      {state.tab === "devices" ? <ReportDevices campaign={campaign} state={state} summary={summary} /> : null}
    </div>
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
