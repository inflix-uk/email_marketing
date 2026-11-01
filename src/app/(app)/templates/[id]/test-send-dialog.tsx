"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { contentHash } from "@/lib/spam-check";
import { cn } from "@/lib/utils";
import { sendTemplateTest, type SendTestState } from "./actions";

/** One logged template test (serialised for the client). */
export interface TemplateTestLogItem {
  id: string;
  to: string;
  subject: string;
  status: "sent" | "failed";
  error: string | null;
  contentHash: string;
  /** Pre-formatted on the server (avoids time-zone hydration mismatches). */
  when: string;
}

/** Must match templateTestHash() on the server (subject falls back to the name). */
function currentHash(name: string, subject: string, html: string): string {
  return contentHash({ subject: subject.trim() || name.trim(), html });
}

/**
 * "Send test" button + dialog: up to 5 addresses, an optional subject for the
 * test, a Mail-Tester hint and the last few tests of this template.
 */
export function TestSendDialog({
  templateId,
  name,
  subject,
  previewText,
  html,
  defaultTo,
  tests,
}: {
  templateId: string;
  /** Current editor values (possibly unsaved) - that's what gets sent. */
  name: string;
  subject: string;
  previewText: string;
  html: string;
  defaultTo: string;
  tests: TemplateTestLogItem[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [state, action, sending] = useActionState<SendTestState, FormData>(sendTemplateTest, {});
  const [to, setTo] = useState(defaultTo);
  const [testSubject, setTestSubject] = useState("");

  const hash = currentHash(name, subject, html);
  const last = tests[0];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => dialogRef.current?.showModal()}>
          Send test
        </Button>
        {last ? (
          <span className="text-xs text-slate-500">
            Last test {last.status === "sent" ? "sent to" : "failed for"} {last.to}, {last.when}
            {last.contentHash !== hash ? <span className="text-amber-700"> · content changed since</span> : null}
          </span>
        ) : null}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg bg-white p-0 shadow-xl ring-1 ring-slate-200 backdrop:bg-slate-900/40"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <form
          action={(formData) => {
            formData.set("id", templateId);
            formData.set("name", name);
            formData.set("subject", subject);
            formData.set("previewText", previewText);
            formData.set("html", html);
            action(formData);
          }}
          className="space-y-4 p-6"
        >
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              Send a test
            </h2>
            <p className="mt-1 text-sm text-slate-500">Sends what&apos;s in the editor now, saved or not.</p>
          </div>

          <Field label="Send to" htmlFor={`${titleId}-to`} hint="Up to 5 addresses, separated by commas.">
            <Input
              id={`${titleId}-to`}
              name="to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </Field>

          <Field label="Subject (optional)" htmlFor={`${titleId}-subject`}>
            <Input
              id={`${titleId}-subject`}
              name="testSubject"
              value={testSubject}
              onChange={(e) => setTestSubject(e.target.value)}
              maxLength={300}
              placeholder={`[Test] ${subject.trim() || name.trim() || "Template subject"}`}
            />
          </Field>

          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Testing with Mail-Tester? Open{" "}
            <a href="https://www.mail-tester.com" target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 hover:text-indigo-500">
              mail-tester.com
            </a>
            , copy the address it shows, paste it here, send, then check your score there.
          </p>

          {!sending && (state.error || state.message) ? (
            <p
              role={state.error ? "alert" : "status"}
              className={cn("text-sm", state.error ? "text-red-600" : state.warning ? "text-amber-700" : "text-emerald-700")}
            >
              {state.error ?? state.message}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
              Close
            </Button>
            <Button type="submit" disabled={sending}>
              {sending ? "Sending..." : "Send test"}
            </Button>
          </div>

          {tests.length > 0 ? (
            <div className="border-t border-slate-100 pt-3">
              <h3 className="text-xs font-medium text-slate-500">Recent tests</h3>
              <ul className="mt-1.5 space-y-1 text-xs">
                {tests.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className={t.status === "sent" ? "text-emerald-700" : "text-red-600"}>
                      {t.status === "sent" ? "Sent" : "Failed"}
                    </span>
                    <span className="break-all text-slate-800">{t.to}</span>
                    <span className="text-slate-400">{t.when}</span>
                    {t.contentHash !== hash ? <span className="text-amber-700">content changed since test</span> : null}
                    {t.error ? <span className="w-full break-words text-red-600">{t.error}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      </dialog>
    </>
  );
}
