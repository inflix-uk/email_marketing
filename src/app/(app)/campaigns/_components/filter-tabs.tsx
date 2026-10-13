import Link from "next/link";
import { cn, formatNumber } from "@/lib/utils";

export interface FilterTab {
  label: string;
  href: string;
  active: boolean;
  count?: number;
}

/** Underlined tab row driven by links (?status=, ?filter=). */
export function FilterTabs({
  tabs,
  label,
  preserveScroll = false,
  className,
}: {
  tabs: FilterTab[];
  /** Accessible name for the nav landmark. */
  label: string;
  /** Keep the scroll position when switching (for tabs lower down a page). */
  preserveScroll?: boolean;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("flex gap-1 overflow-x-auto border-b border-slate-200", className)}>
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={tab.href}
          scroll={!preserveScroll}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            tab.active
              ? "border-indigo-600 text-indigo-700"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
          )}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs tabular-nums",
                tab.active ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600",
              )}
            >
              {formatNumber(tab.count)}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
