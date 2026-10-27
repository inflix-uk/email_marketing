import type { NextRequest } from "next/server";
import { collections } from "@/db";
import { audit } from "@/lib/audit";
import { authorizeRequest } from "@/lib/auth";
import {
  contactNames,
  parseReportFilter,
  RECIPIENT_PROJECTION,
  recipientsQuery,
  toRecipient,
  type RecipientDoc,
} from "@/lib/reports/campaign";
import { CSV_BOM, csvFileName, toCsv, type CsvCell } from "@/lib/reports/csv";

/** Recipients written to the response per chunk. */
const BATCH_SIZE = 1000;

const COLUMNS = [
  "email",
  "name",
  "status",
  "variant",
  "opens",
  "clicks",
  "sent_at",
  "opened_at",
  "clicked_at",
  "bounced_at",
  "soft_bounced_at",
  "unsubscribed_at",
  "complained_at",
  "last_activity_at",
  "error",
];

async function csvRows(docs: RecipientDoc[], hideBots: boolean): Promise<string> {
  const names = await contactNames(docs.map((d) => d.contactId));
  const rows: CsvCell[][] = docs.map((d) => {
    const r = toRecipient(d, names.get(d.contactId) ?? "", { hideBots });
    return [
      d.email,
      r.name,
      r.delivery,
      d.variant ?? "",
      r.opens,
      r.clicks,
      d.sentAt,
      d.openedAt,
      d.clickedAt,
      d.bouncedAt,
      d.softBouncedAt,
      d.unsubscribedAt,
      d.complainedAt,
      r.lastActivityAt,
      // Only failures carry an error worth exporting; keep it on one line.
      d.status === "failed" || d.status === "skipped" || d.bouncedAt ? (d.lastError ?? "").replace(/\s+/g, " ").trim() : "",
    ];
  });
  return toCsv(rows);
}

/**
 * GET /api/campaigns/[id]/export?filter=&q=&bots=hide - the campaign's
 * recipients as CSV, with the same filter / search as the Recipients tab
 * (times in UTC, ISO 8601). Cells that could run as spreadsheet formulas are
 * prefixed with '. Streamed from a cursor in batches, so large campaigns
 * never sit in memory as a whole.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // proxy.ts already blocks anonymous /api/* requests; check again here anyway.
  // Recipient data: viewers can't download it.
  const auth = await authorizeRequest("export");
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const { campaigns, sends } = await collections();
  const campaign = await campaigns.findOne({ _id: id }, { projection: { name: 1 } });
  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  await audit(auth.session, "campaign.export", { type: "campaign", id: campaign._id, details: { name: campaign.name } });

  const sp = request.nextUrl.searchParams;
  const filter = parseReportFilter(sp.get("filter") ?? undefined);
  const hideBots = sp.get("bots") === "hide";
  const query = await recipientsQuery(campaign._id, filter, sp.get("q") ?? "", { hideBots });

  // Ordered by the unique (campaignId, contactId) index: stable, and no in-memory sort.
  const cursor = sends
    .find<RecipientDoc>(query, { projection: RECIPIENT_PROJECTION })
    .sort({ campaignId: 1, contactId: 1 })
    .batchSize(BATCH_SIZE);
  const encoder = new TextEncoder();
  const suffix = filter === "all" ? "recipients" : `recipients-${filter.replace("_", "-")}`;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${CSV_BOM}${toCsv([COLUMNS])}`));
    },
    async pull(controller) {
      try {
        const batch: RecipientDoc[] = [];
        while (batch.length < BATCH_SIZE) {
          const doc = await cursor.next();
          if (!doc) break;
          batch.push(doc);
        }
        if (batch.length > 0) controller.enqueue(encoder.encode(await csvRows(batch, hideBots)));
        if (batch.length < BATCH_SIZE) {
          await cursor.close();
          controller.close();
        }
      } catch (err) {
        console.error("[campaign export] failed", err);
        await cursor.close().catch(() => {});
        controller.error(err);
      }
    },
    async cancel() {
      await cursor.close().catch(() => {});
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(campaign.name, suffix)}"`,
      "Cache-Control": "no-store",
    },
  });
}
