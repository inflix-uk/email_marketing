import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Badge, Card, CardBody, CardHeader, EmptyState, Table, TBody, Td, Th } from "@/components/ui/layout";
import type { Campaign } from "@/db/schema";
import {
  getRecipientTimeline,
  getReportRecipients,
  REPORT_FILTER_LABELS,
  REPORT_FILTERS,
  REPORT_PAGE_SIZE,
  type ReportRecipient,
  type ReportSummary,
} from "@/lib/reports/campaign";
import { formatUkDateTime } from "@/lib/reports/time-buckets";
import { cn, formatNumber } from "@/lib/utils";
import { DownloadLink } from "../_components/download-link";
import { FilterTabs } from "../_components/filter-tabs";
import { Pagination } from "../_components/pagination";
import { isTextOnly, reportHref, type ReportState } from "./report-state";

export async function ReportRecipients({ campaign, state, summary }: { campaign: Campaign; state: ReportState; summary: ReportSummary }) {
  const options = { hideBots: state.hideBots };
  const [result, timeline] = await Promise.all([
    getReportRecipients(campaign.id, { filter: state.filter, search: state.search, page: state.page }, options),
    state.sendId ? getRecipientTimeline(campaign.id, state.sendId, options) : Promise.resolve(null),
  ]);
  const textOnly = isTextOnly(campaign);
  const filters = REPORT_FILTERS.filter(
    (f) => f === "all" || f === state.filter || (summary.filters[f] > 0 && !(textOnly && (f === "opened" || f === "not_opened"))),
  );

  const exportQs = new URLSearchParams();
  if (state.filter !== "all") exportQs.set("filter", state.filter);
  if (state.search) exportQs.set("q", state.search);
  if (state.hideBots) exportQs.set("bots", "hide");
  const exportHref = `/api/campaigns/${campaign.id}/export${exportQs.size ? `?${exportQs}` : ""}`;

  return (
    <div className="space-y-6">
      {timeline ? (
        <Card className="break-inside-avoid">
          <CardHeader
            title={timeline.email}
            description="What happened with this email (UK time)"
            actions={
              <ButtonLink href={reportHref(state, { sendId: null })} scroll={false} variant="ghost" size="sm" className="print:hidden">
                Close
              </ButtonLink>
            }
          />
          <CardBody>
            {timeline.events.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing yet - this email hasn&apos;t been sent.</p>
            ) : (
              <ol className="space-y-2 border-l border-slate-200 pl-4">
                {timeline.events.map((e, i) => (
                  <li key={i} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-indigo-500" aria-hidden />
                    <span className="mr-2 tabular-nums text-slate-500">{formatUkDateTime(e.at)}</span>
                    <span className="font-medium text-slate-900">{e.label}</span>
                    {e.detail ? <span className="ml-2 break-all text-slate-600">{e.detail}</span> : null}
                    {e.flag ? (
                      <span className="ml-2">
                        <Badge tone="yellow">{e.flag}</Badge>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader
          title="Recipients"
          actions={
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <form action={`/campaigns/${campaign.id}`} className="flex items-center gap-2" role="search">
                <input type="hidden" name="tab" value="recipients" />
                {state.filter !== "all" ? <input type="hidden" name="filter" value={state.filter} /> : null}
                {state.hideBots ? <input type="hidden" name="bots" value="hide" /> : null}
                <Input
                  type="search"
                  name="q"
                  defaultValue={state.search}
                  placeholder="Search email or name"
                  aria-label="Search recipients"
                  className="h-8 w-56"
                />
              </form>
              {result.total > 0 ? <DownloadLink href={exportHref}>Export CSV</DownloadLink> : null}
            </div>
          }
        />
        <FilterTabs
          label="Filter recipients"
          className="px-3"
          preserveScroll
          tabs={filters.map((f) => ({
            label: REPORT_FILTER_LABELS[f],
            href: reportHref(state, { filter: f, page: 1, sendId: null }),
            active: f === state.filter,
            count: summary.filters[f],
          }))}
        />
        {result.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title={state.search ? "Nobody matches that search." : "Nobody here yet."} />
          </div>
        ) : (
          <RecipientsTable rows={result.rows} state={state} />
        )}
        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          pageSize={REPORT_PAGE_SIZE}
          total={result.total}
          preserveScroll
          hrefFor={(p) => reportHref(state, { page: p, sendId: null })}
        />
      </Card>
    </div>
  );
}

function deliveryTone(label: string): "green" | "red" | "yellow" | "gray" {
  if (label === "Sent") return "green";
  if (label === "Hard bounce" || label === "Failed") return "red";
  if (label === "Soft bounce" || label === "Skipped") return "yellow";
  return "gray";
}

function RecipientsTable({ rows, state }: { rows: ReportRecipient[]; state: ReportState }) {
  return (
    <Table>
      <thead className="bg-slate-50">
        <tr>
          <Th>Email</Th>
          <Th>Name</Th>
          <Th>Status</Th>
          <Th className="text-right">Opens</Th>
          <Th className="text-right">Clicks</Th>
          <Th>Last activity</Th>
        </tr>
      </thead>
      <TBody>
        {rows.map((row) => (
          <tr key={row.id} className={cn(row.id === state.sendId && "bg-indigo-50/60")}>
            <Td className="max-w-64">
              <Link
                href={reportHref(state, { sendId: row.id })}
                scroll={false}
                className="block truncate font-medium text-slate-900 hover:text-indigo-600"
                title="Show what happened with this email"
              >
                {row.email}
              </Link>
            </Td>
            <Td className="max-w-48 truncate">
              {row.name ? (
                <Link href={`/contacts/${row.contactId}`} className="hover:text-indigo-600">
                  {row.name}
                </Link>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </Td>
            <Td>
              <span className="inline-flex flex-wrap gap-1" title={row.lastError ?? undefined}>
                <Badge tone={deliveryTone(row.delivery)}>{row.delivery}</Badge>
                {row.unsubscribed ? <Badge>Unsubscribed</Badge> : null}
                {row.complained ? <Badge tone="red">Complained</Badge> : null}
              </span>
            </Td>
            <Td className="text-right tabular-nums">{formatNumber(row.opens)}</Td>
            <Td className="text-right tabular-nums">{formatNumber(row.clicks)}</Td>
            <Td className="whitespace-nowrap tabular-nums">{formatUkDateTime(row.lastActivityAt)}</Td>
          </tr>
        ))}
      </TBody>
    </Table>
  );
}
