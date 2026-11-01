import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/layout";
import { cn } from "@/lib/utils";

/** A number card. `help` is the plain-words explanation (tooltip); `href` makes the card a link. */
export function MetricCard({
  label,
  value,
  hint,
  help,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  help?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="flex items-center gap-1 text-sm font-medium text-slate-500">
        {label}
        {help ? <HelpDot text={help} /> : null}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </>
  );
  return (
    <Card className={cn("px-5 py-4 break-inside-avoid", href && "transition-colors hover:border-indigo-300 hover:bg-indigo-50/30")}>
      {href ? (
        <Link href={href} className="block" title={help}>
          {body}
        </Link>
      ) : (
        <div title={help}>{body}</div>
      )}
    </Card>
  );
}

/** Small "?" that explains a metric on hover. */
export function HelpDot({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500 print:hidden"
    >
      ?
    </span>
  );
}

/** Horizontal share bar for tables. */
export function ShareBar({ part, whole }: { part: number; whole: number }) {
  const pct = whole > 0 ? Math.min(100, (part / whole) * 100) : 0;
  return (
    <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 align-middle" aria-hidden>
      <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
    </span>
  );
}
