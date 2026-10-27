import Link from "next/link";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/layout";
import type { Campaign } from "@/db/schema";
import { getActivity, getLinkStats, type ReportSummary } from "@/lib/reports/campaign";
import { formatRate, formatShare, METRIC_HELP } from "@/lib/reports/metrics";
import { getSettings } from "@/lib/settings";
import { formatNumber } from "@/lib/utils";
import { ActivityChart } from "./activity-chart";
import { isTextOnly, recipientsHref, reportHref, type ReportState } from "./report-state";
import { MetricCard, ShareBar } from "./report-ui";

const TOP_LINKS = 5;

export async function ReportOverview({ campaign, state, summary }: { campaign: Campaign; state: ReportState; summary: ReportSummary }) {
  const options = { hideBots: state.hideBots };
  const settings = await getSettings();
  const [activity, links] = await Promise.all([
    getActivity(campaign.id, options),
    getLinkStats(campaign.id, options, settings.appUrl),
  ]);
  const m = summary.metrics;
  const textOnly = isTextOnly(campaign);
  const linkClicks = links.reduce((sum, l) => sum + l.clicks, 0);
  const people = (n: number) => `${formatNumber(n)} ${n === 1 ? "person" : "people"}`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-7 print:grid-cols-4">
        <MetricCard
          label="Sent"
          value={formatNumber(summary.sent)}
          hint={`${formatNumber(m.acceptedExclHardBounces)} without hard bounces`}
          help={`${METRIC_HELP.sent} ${METRIC_HELP.accepted}`}
          href={recipientsHref(state, "all")}
        />
        <MetricCard
          label="Opens"
          value={textOnly ? "N/A" : formatRate(m.openRate)}
          hint={textOnly ? "Plain-text emails can't track opens" : `${people(summary.uniqueOpens)} · ${formatNumber(summary.totalOpens)} total`}
          help={`${METRIC_HELP.openRate} ${METRIC_HELP.total}`}
          href={textOnly ? undefined : recipientsHref(state, "opened")}
        />
        <MetricCard
          label="Clicks"
          value={textOnly ? "N/A" : formatRate(m.clickRate)}
          hint={textOnly ? "Plain-text emails can't track clicks" : `${people(summary.uniqueClicks)} · ${formatNumber(summary.totalClicks)} total`}
          help={`${METRIC_HELP.clickRate} ${METRIC_HELP.total}`}
          href={textOnly ? undefined : recipientsHref(state, "clicked")}
        />
        <MetricCard
          label="Click-to-open"
          value={textOnly ? "N/A" : formatRate(m.clickToOpenRate)}
          hint="of openers clicked"
          help={METRIC_HELP.clickToOpenRate}
        />
        <MetricCard
          label="Unsubscribes"
          value={formatNumber(summary.unsubscribes)}
          hint={formatRate(m.unsubscribeRate)}
          help={METRIC_HELP.unsubscribeRate}
          href={recipientsHref(state, "unsubscribed")}
        />
        <MetricCard
          label="Bounces"
          value={formatNumber(summary.hardBounces + summary.softBounces)}
          hint={`${formatNumber(summary.hardBounces)} hard · ${formatNumber(summary.softBounces)} soft · ${formatRate(m.bounceRate)}`}
          help={METRIC_HELP.bounceRate}
          href={recipientsHref(state, "bounced")}
        />
        <MetricCard
          label="Complaints"
          value={formatNumber(summary.complaints)}
          hint={formatRate(m.complaintRate)}
          help={METRIC_HELP.complaintRate}
          href={recipientsHref(state, "complained")}
        />
      </div>

      {summary.filters.failed > 0 ? (
        <p className="text-sm text-slate-600">
          <Link href={recipientsHref(state, "failed")} className="font-medium text-indigo-600 hover:text-indigo-500">
            {formatNumber(summary.filters.failed)} not sent
          </Link>{" "}
          (failed or skipped).
        </p>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3 break-inside-avoid">
          <CardHeader title="Activity over time" />
          <CardBody>
            {activity && activity.buckets.some((b) => b.opens || b.clicks) ? (
              <ActivityChart activity={activity} />
            ) : (
              <EmptyState title={textOnly ? "Plain-text emails can't track opens or clicks." : "No opens or clicks yet."} />
            )}
          </CardBody>
        </Card>

        <Card className="overflow-hidden xl:col-span-2 break-inside-avoid">
          <CardHeader
            title="Top links"
            actions={
              links.length > TOP_LINKS ? (
                <Link href={reportHref(state, { tab: "links" })} className="text-sm font-medium text-indigo-600 hover:text-indigo-500 print:hidden">
                  All links
                </Link>
              ) : null
            }
          />
          {links.length === 0 ? (
            <div className="p-6">
              <EmptyState title={textOnly ? "Plain-text emails can't track clicks." : "No clicks yet."} />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {links.slice(0, TOP_LINKS).map((l) => (
                <li key={l.url} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-slate-700" title={l.url}>
                    {l.url}
                  </span>
                  <ShareBar part={l.clicks} whole={linkClicks} />
                  <span className="w-16 text-right tabular-nums text-slate-900" title={`${formatNumber(l.clicks)} clicks`}>
                    {formatShare(l.clicks, linkClicks)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
