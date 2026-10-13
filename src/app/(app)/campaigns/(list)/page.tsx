import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import { collections } from "@/db";
import type { CampaignStatus } from "@/db/schema";
import { countRecipients, getCampaignsStats, type CampaignStats } from "@/lib/sending";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/utils";
import { FilterTabs } from "../_components/filter-tabs";
import { LocalDateTime } from "../_components/local-time";
import { Pagination } from "../_components/pagination";
import { firstParam, isEditable, parsePage } from "../_lib/queries";

export const metadata: Metadata = { title: "Campaigns" };

const PAGE_SIZE = 25;

const TABS: { key: string; label: string; statuses: CampaignStatus[] | null; empty: string }[] = [
  { key: "all", label: "All", statuses: null, empty: "No campaigns yet." },
  { key: "draft", label: "Drafts", statuses: ["draft"], empty: "No drafts. Campaigns you're still working on show up here." },
  { key: "scheduled", label: "Scheduled", statuses: ["scheduled"], empty: "Nothing scheduled. Schedule a campaign from its review panel." },
  { key: "sending", label: "Sending", statuses: ["sending", "paused"], empty: "Nothing is sending right now." },
  { key: "sent", label: "Sent", statuses: ["sent"], empty: "No sent campaigns yet." },
];

type Row = {
  id: string;
  name: string;
  subject: string;
  status: CampaignStatus;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  totalRecipients: number;
  listIds: string[];
  segmentIds: string[];
};

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; page?: string | string[] }>;
}) {
  const params = await searchParams;
  const tab = TABS.find((t) => t.key === firstParam(params.status)) ?? TABS[0];

  const { campaigns } = await collections();
  const statusCounts = await campaigns
    .aggregate<{ _id: CampaignStatus; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }])
    .toArray();
  const countOf = (statuses: CampaignStatus[] | null) =>
    statusCounts.filter((s) => !statuses || statuses.includes(s._id)).reduce((sum, s) => sum + s.n, 0);
  const grandTotal = countOf(null);

  const newButton = <ButtonLink href="/campaigns/new">New campaign</ButtonLink>;
  const header = (
    <PageHeader
      title="Campaigns"
      description="Write an email once and send it to your lists or segments, then track opens and clicks."
      actions={newButton}
    />
  );

  if (grandTotal === 0) {
    return (
      <>
        {header}
        <GettingStarted />
      </>
    );
  }

  const tabTotal = countOf(tab.statuses);
  const pageCount = Math.max(1, Math.ceil(tabTotal / PAGE_SIZE));
  const page = Math.min(parsePage(params.page), pageCount);

  const docs = await campaigns
    .find(tab.statuses ? { status: { $in: tab.statuses } } : {}, {
      projection: {
        name: 1,
        subject: 1,
        status: 1,
        scheduledAt: 1,
        startedAt: 1,
        completedAt: 1,
        updatedAt: 1,
        totalRecipients: 1,
        listIds: 1,
        segmentIds: 1,
      },
    })
    .sort(tab.key === "scheduled" ? { scheduledAt: 1, _id: 1 } : { updatedAt: -1, _id: 1 })
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();
  const rows: Row[] = docs.map((d) => ({
    id: d._id,
    name: d.name,
    subject: d.subject,
    status: d.status,
    scheduledAt: d.scheduledAt ?? null,
    startedAt: d.startedAt ?? null,
    completedAt: d.completedAt ?? null,
    updatedAt: d.updatedAt,
    totalRecipients: d.totalRecipients ?? 0,
    listIds: d.listIds ?? [],
    segmentIds: d.segmentIds ?? [],
  }));

  // Sent-ish campaigns report real numbers; drafts get an estimate from their lists and segments.
  const reportIds = rows.filter((r) => !isEditable(r.status)).map((r) => r.id);
  const drafts = rows.filter((r) => isEditable(r.status));
  const [stats, estimates] = await Promise.all([
    reportIds.length ? getCampaignsStats(reportIds) : Promise.resolve(new Map<string, CampaignStats>()),
    Promise.all(
      drafts.map(
        async (r) =>
          [r.id, r.listIds.length + r.segmentIds.length ? await countRecipients(r.listIds, r.segmentIds) : 0] as const,
      ),
    ).then((entries) => new Map(entries)),
  ]);

  const tabHref = (key: string) => (key === "all" ? "/campaigns" : `/campaigns?status=${key}`);
  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    if (tab.key !== "all") qs.set("status", tab.key);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `/campaigns?${s}` : "/campaigns";
  };

  return (
    <>
      {header}
      <Card className="overflow-hidden">
        <FilterTabs
          label="Filter campaigns by status"
          className="px-3"
          tabs={TABS.map((t) => ({
            label: t.label,
            href: tabHref(t.key),
            active: t.key === tab.key,
            count: countOf(t.statuses),
          }))}
        />
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title={`No ${tab.label.toLowerCase()} campaigns`} description={tab.empty} action={newButton} />
          </div>
        ) : (
          <>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Campaign</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Recipients</Th>
                  <Th className="text-right">Opens</Th>
                  <Th className="text-right">Clicks</Th>
                  <Th>Date</Th>
                </tr>
              </thead>
              <TBody>
                {rows.map((row) => (
                  <CampaignRow
                    key={row.id}
                    row={row}
                    stats={stats.get(row.id)}
                    estimate={estimates.get(row.id)}
                  />
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageCount={pageCount} pageSize={PAGE_SIZE} total={tabTotal} hrefFor={pageHref} />
          </>
        )}
      </Card>
    </>
  );
}

function CampaignRow({ row, stats, estimate }: { row: Row; stats?: CampaignStats; estimate?: number }) {
  const draft = isEditable(row.status);
  const date = dateColumn(row);

  return (
    <tr className="relative hover:bg-slate-50">
      <Td className="max-w-xs sm:max-w-sm">
        {/* The link's ::after covers the whole row, so any cell is clickable. */}
        <Link
          href={`/campaigns/${row.id}`}
          className="font-medium text-slate-900 after:absolute after:inset-0 hover:text-indigo-600 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-indigo-600"
        >
          {row.name}
        </Link>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {row.subject || <span className="italic">No subject yet</span>}
        </p>
      </Td>
      <Td>
        <StatusBadge status={row.status} />
      </Td>
      <Td className="text-right tabular-nums">
        {draft ? (
          <span className="text-slate-500" title="Estimated from the selected lists and segments">
            {formatNumber(estimate ?? 0)}
          </span>
        ) : (
          formatNumber(stats?.total ?? row.totalRecipients)
        )}
      </Td>
      <Td className="text-right tabular-nums">{stats ? formatPercent(stats.opened, stats.sent) : <Muted />}</Td>
      <Td className="text-right tabular-nums">{stats ? formatPercent(stats.clicked, stats.sent) : <Muted />}</Td>
      <Td className="whitespace-nowrap">
        <span className="block text-xs text-slate-500">{date.label}</span>
        {date.value && row.status === "scheduled" ? (
          <LocalDateTime value={date.value.toISOString()} />
        ) : (
          formatDateTime(date.value)
        )}
      </Td>
    </tr>
  );
}

function Muted() {
  return <span className="text-slate-400">—</span>;
}

function dateColumn(row: Row): { label: string; value: Date | null } {
  switch (row.status) {
    case "scheduled":
      return { label: "Scheduled for", value: row.scheduledAt };
    case "sending":
    case "paused":
      return { label: "Started", value: row.startedAt };
    case "sent":
      return { label: "Sent", value: row.completedAt ?? row.startedAt };
    case "cancelled":
      return { label: "Cancelled", value: row.updatedAt };
    default:
      return { label: "Last edited", value: row.updatedAt };
  }
}

const STEPS = [
  {
    title: "Add your contacts",
    text: "Import a CSV or add people by hand, then group them into lists.",
    href: "/contacts",
    cta: "Go to contacts",
  },
  {
    title: "Pick a design",
    text: "Save a reusable template, or start from one of the ready-made layouts.",
    href: "/templates",
    cta: "Browse templates",
  },
  {
    title: "Create a campaign",
    text: "Choose who gets it, write your subject, send yourself a test, then send or schedule it.",
    href: "/campaigns/new",
    cta: "New campaign",
  },
];

function GettingStarted() {
  return (
    <Card className="px-6 py-10">
      <div className="mx-auto max-w-xl text-center">
        <h2 className="text-lg font-semibold text-slate-900">Send your first campaign</h2>
        <p className="mt-1 text-sm text-slate-500">
          A campaign is one email sent to one or more of your lists. You&apos;ll see opens, clicks and unsubscribes
          here once it goes out.
        </p>
      </div>
      <ol className="mx-auto mt-8 grid max-w-4xl gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.href} className="flex flex-col rounded-lg border border-slate-200 p-5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">
              {i + 1}
            </span>
            <h3 className="mt-3 text-sm font-semibold text-slate-900">{step.title}</h3>
            <p className="mt-1 flex-1 text-sm text-slate-500">{step.text}</p>
            <Link href={step.href} className="mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-500">
              {step.cta} &rarr;
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
