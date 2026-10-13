"use client";

import { useMemo } from "react";
import { buildPreviewDocument } from "@/lib/templates/preview";
import { cn } from "@/lib/utils";
import { PreviewFrame, type PreviewWidth } from "./preview-frame";

export interface EmailPreviewProps {
  /** Raw template HTML; merge tags are filled with the sample contact. */
  html: string;
  width?: PreviewWidth;
  /** Fixed height in px. Omit to grow to fit the email. */
  height?: number;
  className?: string;
}

/** Sandboxed, read-only preview of an email (no scripts; links open in a new tab). */
export function EmailPreview({ html, width = "desktop", height, className }: EmailPreviewProps) {
  const srcDoc = useMemo(() => buildPreviewDocument(html), [html]);

  return (
    <div className={cn("overflow-hidden bg-slate-100", className)}>
      {html.trim() ? (
        <PreviewFrame srcDoc={srcDoc} width={width} height={height ?? "auto"} />
      ) : (
        <div
          className="flex items-center justify-center px-4 py-12 text-sm text-slate-400"
          style={height ? { height } : undefined}
        >
          Nothing to preview yet
        </div>
      )}
    </div>
  );
}

/**
 * Scaled-down, non-interactive snapshot of an email for cards and pickers.
 * Size it with `className` (e.g. "aspect-[4/3]"); the email is rendered at
 * 2.5x the box width and scaled to 40%, so it always shows the desktop layout.
 */
export function EmailThumbnail({ html, className }: { html: string; className?: string }) {
  const srcDoc = useMemo(() => buildPreviewDocument(html), [html]);

  return (
    <div className={cn("relative overflow-hidden bg-slate-100", className)} aria-hidden inert>
      {html.trim() ? (
        <iframe
          title="Email thumbnail"
          srcDoc={srcDoc}
          sandbox=""
          loading="lazy"
          tabIndex={-1}
          className="pointer-events-none absolute top-0 left-0 h-[250%] w-[250%] origin-top-left scale-[0.4] border-0 bg-white"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-slate-400">Empty</div>
      )}
    </div>
  );
}
