import { DatabaseNotConfiguredError } from "@/db";
import { countryFromHeaders } from "@/lib/reports/user-agent";
import { recordOpen } from "@/lib/sending";

// Open-tracking pixel. Public (see src/proxy.ts). Always answers with the
// image, even for unknown ids, database errors or a database that isn't set
// up yet, so emails never show a broken image. Every hit is recorded with its
// user agent and country header; link scanners / bots / Apple's privacy proxy
// are flagged (see recordOpen) so reports can leave them out.

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function pixelResponse(): Response {
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ sendId: string }> }) {
  try {
    const { sendId } = await params;
    await recordOpen(sendId, {
      userAgent: request.headers.get("user-agent"),
      country: countryFromHeaders(request.headers),
    });
  } catch (err) {
    if (!(err instanceof DatabaseNotConfiguredError)) console.error("[tracking] failed to record open", err);
  }
  return pixelResponse();
}
