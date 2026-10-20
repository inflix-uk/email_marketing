"use client";

import { useActionState, useRef, useState } from "react";
import { EmailPreview } from "@/components/email-editor";
import { Button, SubmitButton } from "@/components/ui/button";
import { Alert, Input, Textarea } from "@/components/ui/form";
import { createTemplateFromHtml, type PasteHtmlState } from "./actions";

/** "Paste HTML" card: opens a window to paste email HTML (e.g. from ChatGPT) and create a template from it. */
export function PasteHtmlCard() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [html, setHtml] = useState("");
  const [state, formAction] = useActionState<PasteHtmlState, FormData>(createTemplateFromHtml, {});

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="group flex h-full w-full flex-col overflow-hidden rounded-lg bg-white text-left shadow-sm ring-1 ring-slate-200 transition-shadow hover:ring-2 hover:ring-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        <span
          className="flex aspect-[4/3] w-full items-center justify-center border-b border-slate-200 bg-slate-50 font-mono text-2xl text-slate-400 group-hover:text-indigo-600"
          aria-hidden
        >
          &lt;/&gt;
        </span>
        <span className="px-3 py-2.5 text-sm font-medium text-slate-900 group-hover:text-indigo-600">Paste HTML</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="paste-html-title"
        className="m-auto w-[calc(100%-2rem)] max-w-6xl rounded-lg bg-white p-0 shadow-xl ring-1 ring-slate-200 backdrop:bg-slate-900/40"
      >
        <form action={formAction} className="space-y-4 p-6">
          <div>
            <h2 id="paste-html-title" className="text-base font-semibold text-slate-900">
              Paste HTML
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Ask ChatGPT for &ldquo;an HTML email for &hellip;&rdquo;, copy the whole code and paste it here.
            </p>
          </div>

          {state.error ? <Alert tone="error">{state.error}</Alert> : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <Input name="name" maxLength={120} placeholder="Template name (optional)" aria-label="Template name" />
              <Textarea
                name="html"
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                required
                spellCheck={false}
                placeholder="<!DOCTYPE html> ..."
                aria-label="Email HTML"
                className="h-96 resize-none font-mono text-xs"
              />
            </div>
            <div className="overflow-hidden rounded-md ring-1 ring-slate-200">
              <EmailPreview html={html} height={436} />
            </div>
          </div>

          <p className="text-xs text-slate-500">An unsubscribe link and your company address are added to the bottom if the email has none.</p>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <SubmitButton pendingText="Creating...">Create template</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
