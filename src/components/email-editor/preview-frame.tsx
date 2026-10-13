"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type PreviewWidth = "desktop" | "mobile";

/**
 * - number: fixed height in px (the email scrolls inside the frame)
 * - "auto": grow to fit the email
 * - "fill": fill the nearest positioned ancestor (which must have a height)
 */
export type PreviewHeight = number | "auto" | "fill";

const MOBILE_WIDTH = 375;
const AUTO_MIN_HEIGHT = 160;
const AUTO_MAX_HEIGHT = 10_000;

// No allow-scripts, so nothing in the email can run. allow-same-origin only
// lets *this* component reach into the frame to measure it and to handle link
// clicks. Popups stay blocked; we open safe links ourselves (below).
const SANDBOX = "allow-same-origin";
const OPENABLE_URL = /^(https?:|mailto:|tel:)/i;

/** Low-level sandboxed iframe for an already-built preview document. */
export function PreviewFrame({
  srcDoc,
  width = "desktop",
  height = "auto",
  title = "Email preview",
  className,
}: {
  srcDoc: string;
  width?: PreviewWidth;
  height?: PreviewHeight;
  title?: string;
  className?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  // Scroll position survives re-renders of the document while editing.
  const scrollTop = useRef(0);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let detach: (() => void) | undefined;

    const attach = () => {
      detach?.();
      detach = undefined;
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc?.documentElement || !win) return;
      const cleanups: (() => void)[] = [];

      // Links: open http(s)/mailto/tel in a new tab; drop anything else
      // (javascript:, data:...). In-page #anchors keep working.
      const onLinkClick = (event: MouseEvent) => {
        if (event.type === "auxclick" && event.button !== 1) return;
        const target = event.target as Element | null;
        const link = typeof target?.closest === "function" ? target.closest("a[href]") : null;
        if (!link || (link.getAttribute("href") ?? "").startsWith("#")) return;
        event.preventDefault();
        const url = (link as HTMLAnchorElement).href;
        if (OPENABLE_URL.test(url)) window.open(url, "_blank", "noopener,noreferrer");
      };
      doc.addEventListener("click", onLinkClick, true);
      doc.addEventListener("auxclick", onLinkClick, true);
      cleanups.push(() => {
        doc.removeEventListener("click", onLinkClick, true);
        doc.removeEventListener("auxclick", onLinkClick, true);
      });

      if (height === "auto") {
        const measure = () => {
          const contentHeight = Math.ceil(doc.documentElement.getBoundingClientRect().height);
          const clamped = Math.min(AUTO_MAX_HEIGHT, Math.max(AUTO_MIN_HEIGHT, contentHeight));
          iframe.style.height = `${clamped}px`;
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(doc.documentElement);
        cleanups.push(() => observer.disconnect());
      } else {
        win.scrollTo(0, scrollTop.current);
        const onScroll = () => {
          scrollTop.current = win.scrollY;
        };
        win.addEventListener("scroll", onScroll, { passive: true });
        cleanups.push(() => win.removeEventListener("scroll", onScroll));
      }

      detach = () => cleanups.forEach((fn) => fn());
    };

    iframe.addEventListener("load", attach);
    // The document may have loaded before hydration.
    const doc = iframe.contentDocument;
    if (doc?.readyState === "complete" && doc.URL === "about:srcdoc") attach();

    return () => {
      iframe.removeEventListener("load", attach);
      detach?.();
    };
  }, [height]);

  const mobile = width === "mobile";
  const frame = (
    <iframe
      ref={ref}
      title={title}
      srcDoc={srcDoc}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      className={cn(
        "block border-0 bg-white",
        mobile ? "max-w-full rounded-lg shadow-md ring-1 ring-slate-300" : "w-full",
        height === "fill" && "h-full",
        height === "auto" && "h-[480px]",
      )}
      style={{
        width: mobile ? MOBILE_WIDTH : undefined,
        height: typeof height === "number" ? height : undefined,
      }}
    />
  );

  if (height === "fill") {
    return (
      <div className={cn("absolute inset-0 flex justify-center overflow-hidden", mobile && "p-4", className)}>
        {frame}
      </div>
    );
  }
  return <div className={cn(mobile && "flex justify-center p-4", className)}>{frame}</div>;
}
