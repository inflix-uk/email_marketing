import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { authorizeRequest } from "@/lib/auth";
import { csvHeader, csvRows, exportFileName, sortFieldKeys, type ExportContact } from "@/lib/contacts/csv";
import { parseContactFilters } from "@/lib/contacts/filters";
import { exportContactsCursor, exportFieldKeys, getList } from "@/lib/contacts/queries";

/** Contacts written to the response per chunk. */
const BATCH_SIZE = 1000;

/**
 * GET /api/contacts/export?q=&status=&list=&tag= - download the contacts
 * matching the same filters as the contacts table, as CSV (with a tags column). Streamed from a cursor in
 * batches, so large exports never sit in memory as a whole.
 */
export async function GET(request: NextRequest) {
  // proxy.ts already blocks anonymous /api/* requests; check again here anyway.
  // Recipient data: viewers can't download it.
  const auth = await authorizeRequest("export");
  if ("response" in auth) return auth.response;

  const filters = parseContactFilters(request.nextUrl.searchParams);
  const [keys, list] = await Promise.all([
    exportFieldKeys(filters),
    filters.listId ? getList(filters.listId) : Promise.resolve(null),
  ]);
  const fieldKeys = sortFieldKeys(keys);
  await audit(auth.session, "contacts.export", { type: "contact", details: { ...filters, list: list?.name } });
  const cursor = await exportContactsCursor(filters, BATCH_SIZE);
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(csvHeader(fieldKeys)));
    },
    async pull(controller) {
      try {
        const batch: ExportContact[] = [];
        while (batch.length < BATCH_SIZE) {
          const doc = await cursor.next();
          if (!doc) break;
          batch.push(doc);
        }
        if (batch.length > 0) controller.enqueue(encoder.encode(csvRows(batch, fieldKeys)));
        if (batch.length < BATCH_SIZE) {
          await cursor.close();
          controller.close();
        }
      } catch (err) {
        console.error("[contacts export] failed", err);
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
      "Content-Disposition": `attachment; filename="${exportFileName(list?.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
