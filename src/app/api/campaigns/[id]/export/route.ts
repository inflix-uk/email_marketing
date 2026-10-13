import Papa from "papaparse";
import { collections } from "@/db";
import type { SendDoc } from "@/db/schema";
import { getSession } from "@/lib/auth";

/** Recipients written to the response per chunk. */
const BATCH_SIZE = 1000;

/** Byte-order mark: tells Excel the file is UTF-8. */
const BOM = String.fromCharCode(0xfeff);
const CSV_OPTIONS = { escapeFormulae: true, newline: "\r\n" } as const;

const COLUMNS = [
  "email",
  "status",
  "variant",
  "sent_at",
  "opened_at",
  "clicked_at",
  "bounced_at",
  "unsubscribed_at",
  "error",
] as const;

type ExportSend = Pick<
  SendDoc,
  "email" | "status" | "variant" | "sentAt" | "openedAt" | "clickedAt" | "bouncedAt" | "unsubscribedAt" | "lastError"
>;

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : "");

function csvRows(sends: ExportSend[]): string {
  const rows = sends.map((s) => [
    s.email,
    s.status,
    s.variant ?? "",
    iso(s.sentAt),
    iso(s.openedAt),
    iso(s.clickedAt),
    iso(s.bouncedAt),
    iso(s.unsubscribedAt),
    // Only failures carry an error worth exporting; keep it on one line.
    s.status === "failed" || s.status === "skipped" || s.bouncedAt ? (s.lastError ?? "").replace(/\s+/g, " ").trim() : "",
  ]);
  return `${Papa.unparse(rows, CSV_OPTIONS)}\r\n`;
}

/** "spring-sale-recipients-2026-10-13.csv" */
function fileName(campaignName: string, now = new Date()): string {
  const slug = campaignName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${slug || "campaign"}-recipients-${now.toISOString().slice(0, 10)}.csv`;
}

/**
 * GET /api/campaigns/[id]/export - every recipient of a campaign as CSV
 * (one row per send, with its tracking timestamps in UTC). Streamed from a
 * cursor in batches, so large campaigns never sit in memory as a whole.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // proxy.ts already blocks anonymous /api/* requests; check again here anyway.
  if (!(await getSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { campaigns, sends } = await collections();
  const campaign = await campaigns.findOne({ _id: id }, { projection: { name: 1 } });
  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Ordered by the unique (campaignId, contactId) index: stable, and no in-memory sort.
  const cursor = sends
    .find<ExportSend>(
      { campaignId: campaign._id },
      {
        projection: {
          _id: 0,
          email: 1,
          status: 1,
          variant: 1,
          sentAt: 1,
          openedAt: 1,
          clickedAt: 1,
          bouncedAt: 1,
          unsubscribedAt: 1,
          lastError: 1,
        },
      },
    )
    .sort({ campaignId: 1, contactId: 1 })
    .batchSize(BATCH_SIZE);
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${BOM}${Papa.unparse([[...COLUMNS]], CSV_OPTIONS)}\r\n`));
    },
    async pull(controller) {
      try {
        const batch: ExportSend[] = [];
        while (batch.length < BATCH_SIZE) {
          const doc = await cursor.next();
          if (!doc) break;
          batch.push(doc);
        }
        if (batch.length > 0) controller.enqueue(encoder.encode(csvRows(batch)));
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
      "Content-Disposition": `attachment; filename="${fileName(campaign.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
