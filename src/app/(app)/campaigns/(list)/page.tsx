import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import { collections } from "@/db";
import type { CampaignStatus } from "@/db/schema";
import { countRecipients, getCampaignsStats, type CampaignStats } from "@/lib/sending";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/utils";
import { LocalDateTime } from "../_components/local-time";
import { Pagination } from "../_components/pagination";
import { displaySubject } from "../_lib/display";
import { isEditable, parsePage } from "../_lib/queries";

export const metadata: Metadata = { title: "Campaigns" };

const PAGE_SIZE = 25;

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
};

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const params = await searchParams;
  const { campaigns, contacts } = await collections();
  const total = await campaigns.countDocuments({});

  const newButton = <ButtonLink href="/campaigns/new">New campaign</ButtonLink>;
  const header = <PageHeader title="Campaigns" actions={newButton} />;

  if (total === 0) {
    const hasContacts = (await contacts.countDocuments({}, { limit: 1 })) > 0;
    return (
      <>
        {header}
        <Card className="p-6">
          <EmptyState
            title="No campaigns yet"
            description={hasContacts ? "Pick a template and a list, then send." : "Start by adding your contacts to a list."}
            action={hasContacts ? newButton : <ButtonLink href="/contacts/import">Import contacts</ButtonLink>}
          />
        </Card>
      </>
    );
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(parsePage(params.page), pageCount);
  const docs = await campaigns
    .find(
      {},
      {
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
        },
      },
    )
    .sort({ updatedAt: -1, _id: 1 })
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
  }));

  // Sent campaigns report real numbers; drafts get an estimate from their lists.
  const reportIds = rows.filter((r) => !isEditable(r.status)).map((r) => r.id);
  const drafts = rows.filter((r) => isEditable(r.status));
  const [stats, estimates] = await Promise.all([
    reportIds.length ? getCampaignsStats(reportIds) : Promise.resolve(new Map<string, CampaignStats>()),
    Promise.all(drafts.map(async (r) => [r.id, r.listIds.length ? await countRecipients(r.listIds) : 0] as const)).then(
      (entries) => new Map(entries),
    ),
  ]);

  return (
    <>
      {header}
      <Card className="overflow-hidden">
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Campaign</Th>
              <Th>Status</Th>
              <Th className="text-right">People</Th>
              <Th className="text-right">Opened</Th>
              <Th className="text-right">Clicked</Th>
              <Th>Date</Th>
            </tr>
          </thead>
          <TBody>
            {rows.map((row) => (
              <CampaignRow key={row.id} row={row} stats={stats.get(row.id)} estimate={estimates.get(row.id)} />
            ))}
          </TBody>
        </Table>
        <Pagination
          page={page}
          pageCount={pageCount}
          pageSize={PAGE_SIZE}
          total={total}
          hrefFor={(p) => (p > 1 ? `/campaigns?page=${p}` : "/campaigns")}
        />
      </Card>
    </>
  );
}

function CampaignRow({ row, stats, estimate }: { row: Row; stats?: CampaignStats; estimate?: number }) {
  const draft = isEditable(row.status);
  const date = dateColumn(row);

  return (
    <tr className="relative hover:bg-slate-50">
      <Td className="max-w-md">
        {/* The link's ::after covers the whole row, so any cell is clickable. */}
        <Link
          href={`/campaigns/${row.id}`}
          className="block truncate font-medium text-slate-900 after:absolute after:inset-0 hover:text-indigo-600 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-indigo-600"
        >
          {displaySubject(row.subject) || row.name || <span className="italic text-slate-500">No subject yet</span>}
        </Link>
      </Td>
      <Td>
        <StatusBadge status={row.status} />
      </Td>
      <Td className="text-right tabular-nums">
        {draft ? <span className="text-slate-500">{formatNumber(estimate ?? 0)}</span> : formatNumber(stats?.total ?? row.totalRecipients)}
      </Td>
      <Td className="text-right tabular-nums">{stats ? formatPercent(stats.opened, stats.sent) : <Muted />}</Td>
      <Td className="text-right tabular-nums">{stats ? formatPercent(stats.clicked, stats.sent) : <Muted />}</Td>
      <Td className="whitespace-nowrap">
        <span className="mr-1 text-xs text-slate-500">{date.label}</span>
        {date.value && row.status === "scheduled" ? <LocalDateTime value={date.value.toISOString()} /> : formatDateTime(date.value)}
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
      return { label: "Goes out", value: row.scheduledAt };
    case "sending":
    case "paused":
      return { label: "Started", value: row.startedAt };
    case "sent":
      return { label: "Sent", value: row.completedAt ?? row.startedAt };
    case "cancelled":
      return { label: "Stopped", value: row.updatedAt };
    default:
      return { label: "Edited", value: row.updatedAt };
  }
}
