"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkContent, contentHash, type SpamCheckInput, type SpamFinding, type SpamLocation } from "@/lib/spam-check";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 500;

const PLACE: Record<SpamLocation, string> = {
  subject: "Subject",
  preheader: "Preview text",
  body: "Email",
  text: "Plain text",
};

export interface SpamCheckPanelProps extends SpamCheckInput {
  className?: string;
  /** Start opened instead of showing only the one-line summary. */
  defaultOpen?: boolean;
}

/**
 * Live spam check for the content being edited. Runs in the browser (pure
 * function) 500 ms after the last change; results are tied to a hash of the
 * content they were made from, so an older result never replaces a newer one.
 *
 *   <SpamCheckPanel subject={subject} html={html} />
 */
export function SpamCheckPanel({ subject, preheader, html, text, className, defaultOpen = false }: SpamCheckPanelProps) {
  const input = useMemo<SpamCheckInput>(() => ({ subject, preheader, html, text }), [subject, preheader, html, text]);
  const hash = useMemo(() => contentHash(input), [input]);

  const [result, setResult] = useState<{ hash: string; findings: SpamFinding[] } | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const latest = useRef({ hash, input });

  useEffect(() => {
    latest.current = { hash, input };
  }, [hash, input]);

  const run = useCallback(() => {
    const { hash: h, input: content } = latest.current;
    const findings = checkContent(content);
    // Only keep the result if the content hasn't changed meanwhile.
    if (latest.current.hash === h) setResult({ hash: h, findings });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(run, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [hash, run]);

  const upToDate = result?.hash === hash;
  const visible = (result?.findings ?? []).filter((f) => !dismissed.has(f.id));
  const warnings = visible.filter((f) => f.severity === "warning").length;

  let summary: string;
  if (!result) summary = "Checking…";
  else if (warnings > 0) summary = `${warnings} suggestion${warnings === 1 ? "" : "s"}`;
  else summary = "Looks good";

  return (
    <details open={defaultOpen} className={cn("group rounded-md bg-white text-sm ring-1 ring-slate-200", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 select-none [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" aria-hidden>
          <path fillRule="evenodd" d="M7.2 14.8a.75.75 0 010-1.06L10.94 10 7.2 6.26a.75.75 0 111.06-1.06l4.27 4.27a.75.75 0 010 1.06l-4.27 4.27a.75.75 0 01-1.06 0z" clipRule="evenodd" />
        </svg>
        <span className="font-medium text-slate-700">Spam check</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            !result ? "bg-slate-100 text-slate-600" : warnings > 0 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700",
          )}
        >
          {summary}
        </span>
        <span className="ml-auto text-xs text-slate-400" role="status" aria-live="polite">
          {upToDate ? "Up to date" : "Checking…"}
        </span>
      </summary>

      <div className="space-y-2 border-t border-slate-100 px-3 py-2">
        {visible.length === 0 ? (
          <p className="text-slate-500">{result ? "No suggestions. Nothing here looks like spam." : "Checking…"}</p>
        ) : (
          <ul className="space-y-2">
            {visible.map((f) => (
              <li key={f.id} className="flex items-start gap-2">
                <span
                  className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", f.severity === "warning" ? "bg-amber-500" : "bg-sky-400")}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-800">
                    <span className="text-slate-500">{PLACE[f.location]}: </span>
                    <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.8em] break-all">{f.match}</span>
                  </p>
                  <p className="text-slate-600">{f.suggestion}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDismissed((prev) => new Set(prev).add(f.id))}
                  className="shrink-0 rounded px-1.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title="Hide this suggestion"
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-3 pt-1">
          <button type="button" onClick={run} className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
            Check now
          </button>
          {dismissed.size > 0 ? (
            <button type="button" onClick={() => setDismissed(new Set())} className="text-xs text-slate-500 hover:text-slate-700">
              Show hidden ({dismissed.size})
            </button>
          ) : null}
          <span className="text-xs text-slate-400">Tips only - nothing here stops you sending.</span>
        </div>
      </div>
    </details>
  );
}
