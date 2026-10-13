import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils";
import type { RecentCampaign } from "./data";

/** The most relevant date for a campaign's current status. */
function campaignDate(c: RecentCampaign): { label: string; date: Date | null } {
  switch (c.status) {
    case "sent":
      return { label: "Sent", date: c.completedAt ?? c.startedAt };
    case "sending":
    case "paused":
      return { label: "Started", date: c.startedAt };
    case "scheduled":
      return { label: "Scheduled", date: c.scheduledAt };
    case "cancelled":
      return { label: "Cancelled", date: c.updatedAt };
    default:
      return { label: "Edited", date: c.updatedAt };
  }
}

function Rate({ part, whole }: { part: number; whole: number }) {
  if (!whole) return <span className="text-slate-400">—</span>;
  return (
    <span title={`${formatNumber(part)} of ${formatNumber(whole)} sent`}>{formatPercent(part, whole)}</span>
  );
}

export function RecentCampaigns({ campaigns }: { campaigns: RecentCampaign[] }) {
  return (
    <Card>
      <CardHeader
        title="Recent campaigns"
        description="Your latest activity. Open and click rates are unique opens / clicks per email sent."
        actions={
          campaigns.length ? (
            <ButtonLink href="/campaigns" variant="ghost" size="sm">
              View all
            </ButtonLink>
          ) : null
        }
      />
      {campaigns.length === 0 ? (
        <div className="p-5">
          <EmptyState
            title="No campaigns yet"
            description="A campaign is one email sent to one or more lists. Create a draft, send yourself a test, then send it when you're happy."
            action={<ButtonLink href="/campaigns/new">Create a campaign</ButtonLink>}
          />
        </div>
      ) : (
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th scope="col">Campaign</Th>
              <Th scope="col">Status</Th>
              <Th scope="col">Date</Th>
              <Th scope="col" className="text-right">
                Recipients
              </Th>
              <Th scope="col" className="text-right">
                Opens
              </Th>
              <Th scope="col" className="text-right">
                Clicks
              </Th>
            </tr>
          </thead>
          <TBody>
            {campaigns.map((c) => {
              const { label, date } = campaignDate(c);
              const recipients = c.stats?.total || c.totalRecipients;
              const sent = c.stats?.sent ?? 0;
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td className="max-w-64">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="block truncate font-medium text-slate-900 hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-indigo-600"
                    >
                      {c.name}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={c.status} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    <span className="text-slate-500">{label}</span> {formatDate(date)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {recipients ? formatNumber(recipients) : <span className="text-slate-400">—</span>}
                  </Td>
                  <Td className="text-right tabular-nums">
                    <Rate part={c.stats?.opened ?? 0} whole={sent} />
                  </Td>
                  <Td className="text-right tabular-nums">
                    <Rate part={c.stats?.clicked ?? 0} whole={sent} />
                  </Td>
                </tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
