"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Read-only code / link with a Copy button. */
export function CopyBox({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. not a secure page): the text can still be selected by hand.
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <Button type="button" variant="ghost" size="sm" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre
        tabIndex={0}
        className={cn(
          "max-h-64 overflow-auto rounded-md bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-800 ring-1 ring-inset ring-slate-200",
          multiline ? "whitespace-pre" : "whitespace-pre-wrap break-all",
        )}
      >
        {value}
      </pre>
    </div>
  );
}
