import { Readable } from "node:stream";
import { DatabaseNotConfiguredError } from "@/db";
import { findImage, openImageStream } from "@/lib/files/uploads";

// Serves an uploaded email image. Public (see src/proxy.ts): recipients'
// mail clients fetch these without a session. Only files stored by the
// upload action exist here, and their type was verified from their bytes.

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Tolerate a file extension ("<id>.png"): some mail clients like image URLs to have one.
  const id = (await params).id.replace(/\.[a-z0-9]{1,5}$/i, "");

  try {
    const image = await findImage(id);
    if (!image) return notFound();

    const stream = await openImageStream(image.id);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.size),
        // A file never changes once uploaded (new upload = new id).
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        // Never let a response from this route be treated as a document.
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) return notFound();
    console.error("[files] failed to serve upload", err);
    return new Response("Temporarily unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
}
