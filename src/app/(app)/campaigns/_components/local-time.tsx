"use client";

import { useSyncExternalStore } from "react";
import { formatDateTime } from "@/lib/utils";

const noopSubscribe = () => () => {};

/** false during SSR and hydration, true afterwards - for browser-only values like the timezone. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

const localFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

/**
 * A date/time shown in the viewer's own timezone (e.g. "Wed, 30 Sept 2026, 09:00 BST").
 * The server can't know that timezone, so it renders its own format first.
 */
export function LocalDateTime({ value }: { value: string }) {
  const isClient = useIsClient();
  const date = new Date(value);
  return <time dateTime={date.toISOString()}>{isClient ? localFormat.format(date) : formatDateTime(date)}</time>;
}

/** The viewer's IANA timezone, e.g. "Europe/London". */
export function useTimeZone(): string | null {
  const isClient = useIsClient();
  return isClient ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
}
