import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/layout";
import type { Campaign } from "@/db/schema";
import { getDeviceStats, type Breakdown, type ReportSummary } from "@/lib/reports/campaign";
import { formatShare } from "@/lib/reports/metrics";
import { formatNumber } from "@/lib/utils";
import { isTextOnly, type ReportState } from "./report-state";
import { HelpDot, ShareBar } from "./report-ui";

const MAX_ROWS = 10;

export async function ReportDevices({ campaign, state, summary }: { campaign: Campaign; state: ReportState; summary: ReportSummary }) {
  const stats = await getDeviceStats(campaign.id, { hideBots: state.hideBots }, summary.totalOpens);
  const textOnly = isTextOnly(campaign);

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <BreakdownCard
          title="Device"
          help="From the opening app's details. Webmail = opened in Gmail or Yahoo in a browser; the device isn't known."
          rows={textOnly ? [] : stats.devices}
          empty={textOnly ? "Plain-text emails can't track opens." : "No opens recorded yet."}
        />
        <BreakdownCard
          title="Email app"
          help="Which app opened the email, when it tells us. Unknown means it didn't say."
          rows={textOnly ? [] : stats.clients}
          empty={textOnly ? "Plain-text emails can't track opens." : "No opens recorded yet."}
        />
        <BreakdownCard
          title="Country"
          help="Only shown when the hosting provider tells us the country. We never guess it."
          rows={stats.countries}
          empty="No opens or clicks recorded yet."
        />
      </div>
      <p className="text-xs text-slate-500">
        Device and app details are known for {formatNumber(stats.openEvents)} of {formatNumber(stats.totalOpens)} opens
        {stats.totalOpens ? ` (${formatShare(stats.openEvents, stats.totalOpens)})` : ""}. Country is known for{" "}
        {formatNumber(stats.eventsWithCountry)} of {formatNumber(stats.events)} opens and clicks
        {stats.events ? ` (${formatShare(stats.eventsWithCountry, stats.events)})` : ""}. Older opens have no details.
      </p>
    </div>
  );
}

function BreakdownCard({ title, help, rows, empty }: { title: string; help: string; rows: Breakdown[]; empty: string }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const shown = rows.slice(0, MAX_ROWS);
  const rest = rows.slice(MAX_ROWS).reduce((sum, r) => sum + r.count, 0);
  return (
    <Card className="overflow-hidden break-inside-avoid">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1">
            {title} <HelpDot text={help} />
          </span>
        }
      />
      {rows.length === 0 ? (
        <CardBody>
          <EmptyState title={empty} />
        </CardBody>
      ) : (
        <ul className="divide-y divide-slate-100">
          {[...shown, ...(rest ? [{ name: "Other", count: rest }] : [])].map((r) => (
            <li key={r.name} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-700">{r.name}</span>
              <ShareBar part={r.count} whole={total} />
              <span className="w-16 text-right tabular-nums text-slate-900" title={`${formatNumber(r.count)}`}>
                {formatShare(r.count, total)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
