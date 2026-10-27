import { EmailPreview } from "@/components/email-editor";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/layout";
import type { Campaign } from "@/db/schema";
import { getLinkStats } from "@/lib/reports/campaign";
import { buildClickMapHtml } from "@/lib/reports/links";
import { formatShare } from "@/lib/reports/metrics";
import { getSettings } from "@/lib/settings";
import { formatNumber } from "@/lib/utils";
import { isTextOnly, type ReportState } from "./report-state";

/** The sent email with a badge on each link: its share of all clicks. Rendered in a sandboxed frame (no scripts). */
export async function ReportClickMap({ campaign, state }: { campaign: Campaign; state: ReportState }) {
  if (isTextOnly(campaign)) {
    return (
      <Card>
        <CardBody>
          <EmptyState title="Click map: N/A" description="This was a plain-text email, so there is no layout to show clicks on." />
        </CardBody>
      </Card>
    );
  }

  const settings = await getSettings();
  const links = await getLinkStats(campaign.id, { hideBots: state.hideBots }, settings.appUrl);
  const { html, found } = buildClickMapHtml(campaign.html, links, settings.appUrl);
  const total = links.reduce((sum, l) => sum + l.clicks, 0);
  // Links clicked but not found in the email as it is now (e.g. personalised URLs).
  const missing = links.filter((l) => !found.has(l.url));

  return (
    <div className="grid items-start gap-6 xl:grid-cols-5">
      <Card className="overflow-hidden xl:col-span-3">
        <CardHeader
          title="Click map"
          description="Each link shows its share of all clicks. Hover a badge for the number."
        />
        <EmailPreview html={html} height={760} />
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="About this map" />
        <CardBody className="space-y-3 text-sm text-slate-600">
          <p>
            {formatNumber(total)} link {total === 1 ? "click" : "clicks"} in total. Grey badges are links nobody clicked.
          </p>
          {missing.length ? (
            <div>
              <p className="mb-1 font-medium text-slate-900">Clicked links not shown on the map</p>
              <ul className="space-y-1">
                {missing.slice(0, 20).map((l) => (
                  <li key={l.url} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate" title={l.url}>
                      {l.url}
                    </span>
                    <span className="tabular-nums">{formatShare(l.clicks, total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
