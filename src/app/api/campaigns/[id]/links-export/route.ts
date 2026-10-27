import type { NextRequest } from "next/server";
import { collections } from "@/db";
import { getSession } from "@/lib/auth";
import { getLinkStats } from "@/lib/reports/campaign";
import { CSV_BOM, csvFileName, toCsv } from "@/lib/reports/csv";
import { ratio } from "@/lib/reports/metrics";
import { getSettings } from "@/lib/settings";

/**
 * GET /api/campaigns/[id]/links-export?bots=hide - the Links tab as CSV:
 * url, clicks, unique clickers, share of clicks (0-1, full precision).
 * Unsubscribe / system links are left out, like on the page.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { campaigns } = await collections();
  const campaign = await campaigns.findOne({ _id: id }, { projection: { name: 1 } });
  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  const hideBots = request.nextUrl.searchParams.get("bots") === "hide";
  const settings = await getSettings();
  const links = await getLinkStats(campaign._id, { hideBots }, settings.appUrl);
  const total = links.reduce((sum, l) => sum + l.clicks, 0);
  const csv = toCsv([
    ["url", "clicks", "unique_clickers", "share_of_clicks"],
    ...links.map((l) => [l.url, l.clicks, l.uniqueClickers, ratio(l.clicks, total) ?? ""]),
  ]);

  return new Response(`${CSV_BOM}${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(campaign.name, "links")}"`,
      "Cache-Control": "no-store",
    },
  });
}
