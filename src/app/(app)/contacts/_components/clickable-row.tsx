"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Table row that opens `href` when clicked anywhere. Keyboard and screen
 * reader users get a real link inside the row, so this is a mouse shortcut;
 * clicks on inner links, buttons and form controls are left alone.
 */
export function ClickableRow({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();

  function onClick(e: MouseEvent<HTMLTableRowElement>) {
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label, form")) return;
    if (window.getSelection()?.toString()) return; // the user is selecting text
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
    else router.push(href);
  }

  return (
    <tr onClick={onClick} className={cn("cursor-pointer transition-colors hover:bg-slate-50", className)}>
      {children}
    </tr>
  );
}
