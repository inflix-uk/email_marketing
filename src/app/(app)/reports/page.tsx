import type { Metadata } from "next";
import Link from "next/link";
import { DownloadLink } from "../campaigns/_components/download-link";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Table, TBody, Td, Th } from "@/components/ui/layout";
import { collections } from "@/db";
import { requireSession } from "@/lib/auth";
import { getCampaignCounts } from "@/lib/reports/cross-campaign";
import {
  GROUP_BYS,
  METRICS,
  REPORT_TIMEZONE,
  compareMetric,
  formatChange,
  formatDay,
  formatMetric,
  groupRows,
  londonDate,
  metricDef,
  metricValue,
  parseReportQuery,
  previousRange,
  reportQueryString,
  resolveRange,
  sumCounts,
  type ReportCounts,
} from "@/lib/reports/rollup";
import { listSavedReports, userIdForEmail } from "@/lib/reports/saved";
import { cn } from "@/lib/utils";
import { deleteReportAction } from "./actions";
import { ReportControls } from "./report-controls";
import { PrintButton, SaveReport } from "./save-report";
import { TrendChart } from "./trend-chart";

export const metadata: Metadata = { title: "Reports" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession();
  const query = parseReportQuery(await searchParams);
  const range = resolveRange(query, londonDate(new Date()));
  const prevRange = previousRange(range);
  const queryString = reportQueryString(query);

  const { lists } = await collections();
  const ownerId = await userIdForEmail(session.email);
  const [listDocs, campaigns, previous, saved] = await Promise.all([
    lists.find({}, { projection: { name: 1 } }).collation({ locale: "en", strength: 2 }).sort({ name: 1 }).toArray(),
    getCampaignCounts(range, query.listId),
    query.compare ? getCampaignCounts(prevRange, query.listId) : Promise.resolve([]),
    ownerId ? listSavedReports(ownerId) : Promise.resolve([]),
  ]);
  const listOptions = listDocs.map((l) => ({ id: l._id, name: l.name }));
  const listName = query.listId ? (listOptions.find((l) => l.id === query.listId)?.name ?? "Deleted list") : null;

  const rows = groupRows(campaigns, query.group, range);
  const total = sumCounts(campaigns);
  const previousTotal = sumCounts(previous);
  // Charts read left to right in time; campaign rows are listed newest first.
  const chartRows = query.group === "campaign" ? [...rows].reverse() : rows;
  const groupLabel = GROUP_BYS.find((g) => g.value === query.group)!.label;
  const scope = listName ? `List: ${listName}` : "All lists";
  const dates = `${formatDay(range.from)} – ${formatDay(range.to)}`;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${scope} · ${dates} · UK time`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <DownloadLink href={`/api/reports/export?${queryString}`}>
              Export CSV
            </DownloadLink>
            <PrintButton />
          </div>
        }
      />

      <div className="space-y-6">
        <Card className="print:hidden">
          <CardBody className="space-y-4">
            <ReportControls query={query} range={range} lists={listOptions} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-4">
              <SaveReport query={queryString} />
              {saved.length > 0 ? (
                <ul className="flex flex-wrap items-center gap-2" aria-label="Saved reports">
                  {saved.map((r) => (
                    <li
                      key={r.id}
                      className={cn(
                        "flex items-center rounded-md text-sm ring-1 ring-inset",
                        r.query === queryString ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "bg-white text-slate-700 ring-slate-300",
                      )}
                    >
                      <Link href={`/reports?${r.query}`} className="py-1 pl-3 pr-1 hover:underline">
                        {r.name}
                      </Link>
                      <form action={deleteReportAction.bind(null, r.id)}>
                        <button
                          type="submit"
                          className="px-2 py-1 text-slate-400 hover:text-red-600"
                          aria-label={`Delete saved report ${r.name}`}
                          title="Delete"
                        >
                          ×
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </CardBody>
        </Card>

        {query.compare ? (
          <Card className="break-inside-avoid">
            <CardHeader
              title="Compared with previous period"
              description={`${formatDay(prevRange.from)} – ${formatDay(prevRange.to)}`}
            />
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th></Th>
                  {METRICS.map((m) => (
                    <Th key={m.key} className="text-right">
                      {m.label}
                    </Th>
                  ))}
                </tr>
              </thead>
              <TBody>
                <tr>
                  <Td className="font-medium text-slate-900">These dates</Td>
                  <MetricCells counts={total} />
                </tr>
                <tr>
                  <Td className="font-medium text-slate-900">Previous</Td>
                  <MetricCells counts={previousTotal} />
                </tr>
                <tr>
                  <Td className="font-medium text-slate-900">Change</Td>
                  {METRICS.map((m) => {
                    const c = compareMetric(total, previousTotal, m.key);
                    return (
                      <Td
                        key={m.key}
                        className={cn(
                          "text-right tabular-nums",
                          c.change !== null && c.change > 0 && "text-emerald-700",
                          c.change !== null && c.change < 0 && "text-red-700",
                        )}
                      >
                        {formatChange(c)}
                      </Td>
                    );
                  })}
                </tr>
              </TBody>
            </Table>
            <p className="px-5 py-3 text-xs text-slate-500">Rates change in percentage points (pp).</p>
          </Card>
        ) : null}

        {campaigns.length === 0 ? (
          <Card className="p-6">
            <EmptyState title="No campaigns sent in these dates" description="Try a longer date range or another list." />
          </Card>
        ) : (
          <>
            <Card className="break-inside-avoid">
              <CardBody className={cn("grid gap-6", query.metrics.length > 1 && "lg:grid-cols-2")}>
                {query.metrics.map((key) => (
                  <TrendChart key={key} metric={metricDef(key)} rows={chartRows} />
                ))}
              </CardBody>
            </Card>

            <Card>
              <Table>
                <thead className="bg-slate-50">
                  <tr>
                    <Th>{groupLabel}</Th>
                    {METRICS.map((m) => (
                      <Th key={m.key} className="text-right">
                        {m.label}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <TBody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <Td className="max-w-xs truncate font-medium text-slate-900">
                        {r.campaignId ? (
                          <Link href={`/campaigns/${r.campaignId}`} className="hover:text-indigo-600">
                            {r.label}
                          </Link>
                        ) : (
                          r.label
                        )}
                      </Td>
                      <MetricCells counts={r.counts} />
                    </tr>
                  ))}
                  <tr className="bg-slate-50">
                    <Td className="font-semibold text-slate-900">Total</Td>
                    <MetricCells counts={total} bold />
                  </tr>
                </TBody>
              </Table>
              <p className="px-5 py-3 text-xs text-slate-500">
                Open and click rates are out of emails sent, the same as each campaign report (plain-text-only emails can&apos;t be tracked, so they are left out of rates). CTOR = clicks ÷ opens. Test emails are not
                counted. Times are {REPORT_TIMEZONE}.
              </p>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

function MetricCells({ counts, bold }: { counts: ReportCounts; bold?: boolean }) {
  return METRICS.map((m) => (
    <Td key={m.key} className={cn("text-right tabular-nums", bold && "font-semibold text-slate-900")}>
      {formatMetric(metricValue(counts, m.key), m.kind)}
    </Td>
  ));
}
