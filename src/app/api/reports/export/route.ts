import { collections } from "@/db";
import { getSession } from "@/lib/auth";
import { getCampaignCounts } from "@/lib/reports/cross-campaign";
import { reportFileName, reportToCsv } from "@/lib/reports/report-csv";
import { GROUP_BYS, groupRows, londonDate, parseReportQuery, resolveRange, sumCounts } from "@/lib/reports/rollup";

/** GET /api/reports/export?<report settings> - the /reports table as CSV. */
export async function GET(request: Request) {
  // proxy.ts already blocks anonymous /api/* requests; check again here anyway.
  if (!(await getSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = parseReportQuery(Object.fromEntries(new URL(request.url).searchParams));
  const now = new Date();
  const range = resolveRange(query, londonDate(now));
  const campaigns = await getCampaignCounts(range, query.listId);

  let scope = "All lists";
  if (query.listId) {
    const { lists } = await collections();
    const list = await lists.findOne({ _id: query.listId }, { projection: { name: 1 } });
    scope = `List: ${list?.name ?? "Deleted list"}`;
  }

  const csv = reportToCsv({
    scope,
    range,
    groupLabel: GROUP_BYS.find((g) => g.value === query.group)!.label,
    generatedAt: now,
    rows: groupRows(campaigns, query.group, range),
    total: sumCounts(campaigns),
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportFileName(range)}"`,
      "Cache-Control": "no-store",
    },
  });
}
