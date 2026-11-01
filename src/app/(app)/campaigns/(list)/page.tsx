import type { Metadata } from "next";
import Link from "next/link";
import { Can } from "@/components/role-context";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import { collections } from "@/db";
import type { CampaignFormat, CampaignStatus } from "@/db/schema";
import {
  ARCHIVABLE_STATUSES,
  CAMPAIGN_TABS,
  dateSortLabel,
  defaultTab,
  parseWorkspaceParams,
  searchFilter,
  tabFilter,
  workspaceFilter,
  workspaceHref,
  workspaceSort,
  type CampaignTab,
} from "@/lib/campaigns/workspace";
import { DEFAULT_TIME_ZONE, formatInTimeZone } from "@/lib/schedule";
import { countRecipients, getCampaignsStats, type CampaignStats } from "@/lib/sending";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/utils";
import { cancelSending, unscheduleCampaign } from "../actions";
import { ConfirmButton } from "../_components/action-buttons";
import { BulkBar, BULK_FORM_ID, CampaignMoreMenu, SelectAllCampaigns } from "../_components/campaign-actions";
import { FilterTabs } from "../_components/filter-tabs";
import { Pagination } from "../_components/pagination";
import { WorkspaceToolbar } from "../_components/workspace-toolbar";
import { displaySubject } from "../_lib/display";
import { isEditable, parsePage } from "../_lib/queries";

export const metadata: Metadata = { title: "Campaigns" };

const PAGE_SIZE = 25;

const TAB_LABELS: Record<CampaignTab, string> = {
  sent: "Sent",
  drafts: "Drafts",
  outbox: "Outbox",
  archived: "Archived",
};

type Row = {
  id: string;
  name: string;
  subject: string;
  status: CampaignStatus;
  format: CampaignFormat;
  folder: string | null;
  archived: boolean;
  scheduledAt: Date | null;
  scheduledTimeZone: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  totalRecipients: number;
  listIds: string[];
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const params = parseWorkspaceParams(raw);
  const { campaigns, contacts } = await collections();

  const newButton = (
    <Can permission="edit">
      <ButtonLink href="/campaigns/new">New campaign</ButtonLink>
    </Can>
  );
  const header = <PageHeader title="Campaigns" actions={newButton} />;

  if ((await campaigns.countDocuments({}, { limit: 1 })) === 0) {
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

  // Tab counts follow the search and folder, never the page.
  const search = searchFilter(params.q, params.folder);
  const [countList, folders] = await Promise.all([
    Promise.all(
      CAMPAIGN_TABS.map((t) => campaigns.countDocuments(Object.keys(search).length ? { $and: [tabFilter(t), search] } : tabFilter(t))),
    ),
    campaigns.distinct("folder", { folder: { $nin: [null, ""] } }),
  ]);
  const counts = Object.fromEntries(CAMPAIGN_TABS.map((t, i) => [t, countList[i]])) as Record<CampaignTab, number>;
  const tab = params.tab ?? defaultTab(counts);
  const folderNames = (folders.filter((f): f is string => typeof f === "string" && f !== "")).sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" }),
  );

  const total = counts[tab];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(parsePage(raw.page), pageCount);
  const docs = await campaigns
    .find(workspaceFilter(tab, params.q, params.folder), {
      projection: {
        name: 1,
        subject: 1,
        status: 1,
        format: 1,
        folder: 1,
        archivedAt: 1,
        scheduledAt: 1,
        scheduledTimeZone: 1,
        startedAt: 1,
        completedAt: 1,
        updatedAt: 1,
        totalRecipients: 1,
        listIds: 1,
      },
    })
    .collation({ locale: "en", strength: 2 })
    .sort(workspaceSort(tab, params.sort))
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();
  const rows: Row[] = docs.map((d) => ({
    id: d._id,
    name: d.name,
    subject: d.subject,
    status: d.status,
    format: d.format ?? "html",
    folder: d.folder ?? null,
    archived: Boolean(d.archivedAt),
    scheduledAt: d.scheduledAt ?? null,
    scheduledTimeZone: d.scheduledTimeZone ?? null,
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

  const base = { q: params.q, sort: params.sort, folder: params.folder };
  const tabs = CAMPAIGN_TABS.map((t) => ({
    label: TAB_LABELS[t],
    href: workspaceHref({ ...base, tab: t }),
    active: t === tab,
    count: counts[t],
  }));
  const filtered = Boolean(params.q || params.folder);

  return (
    <>
      {header}
      <FilterTabs tabs={tabs} label="Campaign tabs" className="mb-4" />
      <div className="mb-4">
        <WorkspaceToolbar tab={tab} q={params.q} sort={params.sort} folder={params.folder} folders={folderNames} dateLabel={dateSortLabel(tab)} />
      </div>
      <BulkBar archivedTab={tab === "archived"} folders={folderNames} />
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={filtered ? "Nothing matches" : `No ${TAB_LABELS[tab].toLowerCase()} campaigns`}
              description={filtered ? "Try another search or folder." : tab === "archived" ? "Archived campaigns show up here." : undefined}
            />
          </div>
        ) : (
          <>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th className="w-10">
                    <SelectAllCampaigns />
                  </Th>
                  <Th>Campaign</Th>
                  {tab === "outbox" || tab === "archived" ? <Th>Status</Th> : null}
                  <Th>{tab === "sent" ? "Sent" : tab === "drafts" ? "Last saved" : tab === "outbox" ? "Goes out" : "Date"}</Th>
                  <Th className="text-right">People</Th>
                  {tab === "sent" || tab === "archived" ? (
                    <>
                      <Th className="text-right">Opened</Th>
                      <Th className="text-right">Clicked</Th>
                    </>
                  ) : null}
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <TBody>
                {rows.map((row) => (
                  <CampaignRow
                    key={row.id}
                    row={row}
                    tab={tab}
                    stats={stats.get(row.id)}
                    estimate={estimates.get(row.id)}
                    folders={folderNames}
                  />
                ))}
              </TBody>
            </Table>
            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={total}
              hrefFor={(p) => workspaceHref({ ...base, tab, page: p })}
            />
          </>
        )}
      </Card>
    </>
  );
}

function CampaignRow({
  row,
  tab,
  stats,
  estimate,
  folders,
}: {
  row: Row;
  tab: CampaignTab;
  stats?: CampaignStats;
  estimate?: number;
  folders: string[];
}) {
  const draft = isEditable(row.status);
  const date = dateColumn(row);
  const title = row.name || displaySubject(row.subject);
  const subjectLine = displaySubject(row.subject);
  const showStats = tab === "sent" || tab === "archived";

  return (
    <tr className="relative hover:bg-slate-50">
      <Td className="w-10">
        <input
          type="checkbox"
          name="ids"
          value={row.id}
          form={BULK_FORM_ID}
          aria-label={`Select ${title || "campaign"}`}
          className="relative z-10 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
        />
      </Td>
      <Td className="max-w-md">
        {/* The link's ::after covers the whole row, so any cell is clickable. */}
        <Link
          href={`/campaigns/${row.id}`}
          className="block truncate font-medium text-slate-900 after:absolute after:inset-0 hover:text-indigo-600 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-indigo-600"
        >
          {title || <span className="italic text-slate-500">No subject yet</span>}
        </Link>
        <span className="flex items-center gap-2 truncate text-xs text-slate-500">
          {subjectLine && subjectLine !== title ? <span className="truncate">{subjectLine}</span> : null}
          {row.folder ? <Badge tone="indigo">{row.folder}</Badge> : null}
          {row.format === "text" ? <Badge>Plain text</Badge> : null}
        </span>
      </Td>
      {tab === "outbox" || tab === "archived" ? (
        <Td>
          <StatusBadge status={row.status} />
        </Td>
      ) : null}
      <Td className="whitespace-nowrap">
        {row.status === "scheduled" && row.scheduledAt ? (
          <span className="text-sm">{formatInTimeZone(row.scheduledAt, row.scheduledTimeZone ?? DEFAULT_TIME_ZONE)}</span>
        ) : (
          <>
            {tab === "archived" ? <span className="mr-1 text-xs text-slate-500">{date.label}</span> : null}
            {formatDateTime(date.value)}
          </>
        )}
      </Td>
      <Td className="text-right tabular-nums">
        {draft ? <span className="text-slate-500">{formatNumber(estimate ?? 0)}</span> : formatNumber(stats?.total ?? row.totalRecipients)}
      </Td>
      {showStats ? (
        <>
          <Td className="text-right tabular-nums">
            {row.format === "text" ? <Muted text="N/A" title="Opens can't be tracked for plain-text emails" /> : stats ? formatPercent(stats.opened, stats.sent) : <Muted />}
          </Td>
          <Td className="text-right tabular-nums">{stats ? formatPercent(stats.clicked, stats.sent) : <Muted />}</Td>
        </>
      ) : null}
      <Td className="whitespace-nowrap text-right">
        <div className="relative z-10 inline-flex items-center justify-end gap-1">
          {draft && row.status === "draft" ? (
            <ButtonLink href={`/campaigns/${row.id}`} variant="secondary" size="sm">
              Edit
            </ButtonLink>
          ) : null}
          <Can permission="send">
            {row.status === "scheduled" ? (
              <ConfirmButton
                action={unscheduleCampaign.bind(null, row.id)}
                label="Cancel"
                size="sm"
                title="Cancel the scheduled send?"
                description="It won't go out. You'll find it in Drafts."
                confirmLabel="Cancel send"
                dismissLabel="Keep it"
                pendingText="Cancelling..."
              />
            ) : row.status === "sending" || row.status === "paused" ? (
              <ConfirmButton
                action={cancelSending.bind(null, row.id)}
                label="Cancel"
                size="sm"
                title="Stop sending this campaign?"
                description="Emails already sent can't be recalled. The rest won't go out."
                confirmLabel="Stop sending"
                dismissLabel="Keep sending"
                pendingText="Stopping..."
              />
            ) : null}
          </Can>
          {!draft ? (
            <ButtonLink href={`/campaigns/${row.id}`} variant="secondary" size="sm">
              {row.status === "sending" || row.status === "paused" ? "View" : "View report"}
            </ButtonLink>
          ) : null}
          <Can permission="edit">
            <CampaignMoreMenu
              campaignId={row.id}
              name={title || "Untitled campaign"}
              archived={row.archived}
              canArchive={ARCHIVABLE_STATUSES.includes(row.status)}
              folder={row.folder}
              folders={folders}
            />
          </Can>
        </div>
      </Td>
    </tr>
  );
}

function Muted({ text = "—", title }: { text?: string; title?: string }) {
  return (
    <span className="text-slate-400" title={title}>
      {text}
    </span>
  );
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
