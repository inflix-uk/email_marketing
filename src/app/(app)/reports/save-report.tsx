"use client";

import { useActionState } from "react";
import { Button, SubmitButton } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { saveReportAction, type SaveReportState } from "./actions";

/** "Save" form: stores the current settings under a name. */
export function SaveReport({ query }: { query: string }) {
  const [state, formAction] = useActionState<SaveReportState, FormData>(saveReportAction, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 print:hidden">
      <input type="hidden" name="query" value={query} />
      <Input name="name" required maxLength={80} placeholder="Name this report" aria-label="Report name" className="w-52" />
      <SubmitButton variant="secondary" size="sm" pendingText="Saving...">
        Save
      </SubmitButton>
      {state.error ? <span className="text-xs text-red-600">{state.error}</span> : null}
      {state.ok ? <span className="text-xs text-emerald-700">Saved.</span> : null}
    </form>
  );
}

export function PrintButton() {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
      Print / PDF
    </Button>
  );
}
