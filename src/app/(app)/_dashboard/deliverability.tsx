import type { ReactNode } from "react";
import { cn, formatPercent } from "@/lib/utils";

// Mailbox providers start filtering senders above roughly these rates.
export const BOUNCE_LIMIT = 0.02;
export const COMPLAINT_LIMIT = 0.001;

type Level = "ok" | "warn" | "bad";

/** Amber above the limit, red from 2.5x the limit. */
function levelOf(part: number, whole: number, limit: number): Level {
  if (!whole) return "ok";
  const rate = part / whole;
  if (rate > limit * 2.5) return "bad";
  return rate > limit ? "warn" : "ok";
}

const TONE: Record<Level, string> = { ok: "", warn: "text-amber-700", bad: "text-red-700" };

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={className}>
      <path
        fillRule="evenodd"
        d="M8.26 3.1c.77-1.36 2.72-1.36 3.49 0l5.58 9.92c.75 1.34-.21 2.98-1.74 2.98H4.42c-1.53 0-2.5-1.64-1.74-2.98L8.26 3.1zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * Value and hint for the dashboard's "Bounce rate" tile: bounce rate as the
 * headline, complaint rate underneath, each flagged when it is too high.
 */
export function deliverabilityTile(
  window: { sent: number; bounced: number; complained: number },
  windowLabel: string,
): { value: ReactNode; hint: ReactNode } {
  if (!window.sent) return { value: "—", hint: `No sends in the ${windowLabel.toLowerCase()}` };

  const bounce = levelOf(window.bounced, window.sent, BOUNCE_LIMIT);
  const complaint = levelOf(window.complained, window.sent, COMPLAINT_LIMIT);
  const bounceRate = formatPercent(window.bounced, window.sent);
  const complaintRate = `${formatPercent(window.complained, window.sent)} spam complaints`;

  return {
    value:
      bounce === "ok" ? (
        bounceRate
      ) : (
        <span className={cn("inline-flex items-center gap-1.5", TONE[bounce])}>
          <WarningIcon className="h-5 w-5 shrink-0" />
          {bounceRate}
          <span className="sr-only"> (too high)</span>
        </span>
      ),
    hint: (
      <>
        {bounce !== "ok" ? <span className={cn("font-medium", TONE[bounce])}>Too high - aim for under 2%. </span> : null}
        {complaint === "ok" ? (
          complaintRate
        ) : (
          <span className={cn("font-medium", TONE[complaint])}>{complaintRate} - aim for under 0.1%</span>
        )}
        {bounce === "ok" && complaint === "ok" ? ` · ${windowLabel.toLowerCase()}` : null}
      </>
    ),
  };
}
