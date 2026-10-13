"use client";

import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";

/** A plain <a> styled as a small secondary button, for file downloads (no client-side routing). */
export function DownloadLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} download className={buttonClasses("secondary", "sm", "shrink-0")}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden
      >
        <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
      </svg>
      {children}
    </a>
  );
}
