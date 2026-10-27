import { Card, CardHeader, EmptyState, Table, TBody, Td, Th } from "@/components/ui/layout";
import type { Campaign } from "@/db/schema";
import { getLinkStats } from "@/lib/reports/campaign";
import { formatShare } from "@/lib/reports/metrics";
import { getSettings } from "@/lib/settings";
import { formatNumber } from "@/lib/utils";
import { DownloadLink } from "../_components/download-link";
import { isTextOnly, type ReportState } from "./report-state";
import { HelpDot, ShareBar } from "./report-ui";

export async function ReportLinks({ campaign, state }: { campaign: Campaign; state: ReportState }) {
  const settings = await getSettings();
  const links = await getLinkStats(campaign.id, { hideBots: state.hideBots }, settings.appUrl);
  const totalClicks = links.reduce((sum, l) => sum + l.clicks, 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Links"
        description="Unsubscribe and other system links are left out."
        actions={
          links.length ? (
            <span className="print:hidden">
              <DownloadLink href={`/api/campaigns/${campaign.id}/links-export${state.hideBots ? "?bots=hide" : ""}`}>
                Export CSV
              </DownloadLink>
            </span>
          ) : null
        }
      />
      {links.length === 0 ? (
        <div className="p-6">
          <EmptyState title={isTextOnly(campaign) ? "Plain-text emails can't track clicks." : "No clicks yet."} />
        </div>
      ) : (
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Link</Th>
              <Th className="text-right">
                <span className="inline-flex items-center gap-1">
                  Clicks <HelpDot text="Every click, including repeats by the same person." />
                </span>
              </Th>
              <Th className="text-right">
                <span className="inline-flex items-center gap-1">
                  People <HelpDot text="Different people who clicked this link." />
                </span>
              </Th>
              <Th>
                <span className="inline-flex items-center gap-1">
                  Share <HelpDot text="This link's clicks out of all link clicks." />
                </span>
              </Th>
            </tr>
          </thead>
          <TBody>
            {links.map((l) => (
              <tr key={l.url}>
                <Td className="max-w-xl">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="block truncate text-slate-900 hover:text-indigo-600" title={l.url}>
                    {l.url}
                  </a>
                </Td>
                <Td className="text-right tabular-nums">{formatNumber(l.clicks)}</Td>
                <Td className="text-right tabular-nums">{formatNumber(l.uniqueClickers)}</Td>
                <Td className="whitespace-nowrap tabular-nums">
                  <span className="inline-flex items-center gap-2">
                    <ShareBar part={l.clicks} whole={totalClicks} />
                    {formatShare(l.clicks, totalClicks)}
                  </span>
                </Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
