"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { EmailEditor } from "@/components/email-editor";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { saveTemplate, type SaveTemplateState } from "../actions";
import { sendTemplateTest, type SendTestState } from "./actions";

export interface EditableTemplate {
  id: string;
  name: string;
  subject: string | null;
  /** Not editable here; kept as stored and used for test sends. */
  previewText: string | null;
  html: string;
  /** Visual-editor design JSON; null = hand-written HTML. */
  design: string | null;
}

// Fields row + editor + test row fit one screen on desktop; the panes scroll inside.
const EDITOR_HEIGHT = "max(28rem, calc(100dvh - 13.5rem))";

export function TemplateForm({
  template,
  testRecipient,
  secondaryActions,
}: {
  /** The saved version; re-fetched after every save. */
  template: EditableTemplate;
  /** Pre-filled test address (the signed-in user). */
  testRecipient: string;
  /** Quiet actions (duplicate, delete) shown at the end of the bottom row. */
  secondaryActions?: ReactNode;
}) {
  const [saveState, saveAction, saving] = useActionState<SaveTemplateState, FormData>(saveTemplate, {});
  const [testState, testAction, testing] = useActionState<SendTestState, FormData>(sendTemplateTest, {});

  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject ?? "");
  const [html, setHtml] = useState(template.html);
  const [design, setDesign] = useState(template.design ?? "");
  const [testTo, setTestTo] = useState(testRecipient);
  const formRef = useRef<HTMLFormElement>(null);

  const dirty =
    name.trim() !== template.name ||
    subject.trim() !== (template.subject ?? "") ||
    html !== template.html ||
    design !== (template.design ?? "");

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Warn before closing / reloading the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const errors = saveState.fieldErrors ?? {};

  return (
    <>
      <form ref={formRef} action={saveAction} className="space-y-4">
        <input type="hidden" name="id" value={template.id} />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <Field label="Name" htmlFor="name" error={errors.name} className="lg:w-72 xl:w-80">
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <Field label="Subject" htmlFor="subject" error={errors.subject} className="min-w-0 flex-1">
            <Input
              id="subject"
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="What's this email about?"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3 lg:pt-[26px]">
            <SaveStatus saving={saving} dirty={dirty} saved={Boolean(saveState.ok)} />
            <Button type="submit" disabled={saving} title="Save (Ctrl+S)">
              {saving ? "Saving..." : "Save"}
            </Button>
            {/* Saves first, then opens a new campaign with this template. */}
            <Button type="submit" name="then" value="campaign" variant="secondary" disabled={saving}>
              Use in campaign
            </Button>
          </div>
        </div>

        {saveState.error && !saving ? <Alert tone="error">{saveState.error}</Alert> : null}

        <EmailEditor
          name="html"
          defaultValue={template.html}
          onChange={setHtml}
          designName="design"
          defaultDesign={template.design}
          onDesignChange={setDesign}
          height={EDITOR_HEIGHT}
        />
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <form
          action={(formData) => {
            formData.set("name", name);
            formData.set("subject", subject);
            formData.set("previewText", template.previewText ?? "");
            formData.set("html", html);
            testAction(formData);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <label htmlFor="test-to" className="text-sm text-slate-600">
            Send a test to
          </label>
          <Input
            id="test-to"
            name="to"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            className="w-64"
          />
          <Button type="submit" variant="secondary" disabled={testing}>
            {testing ? "Sending..." : "Send test"}
          </Button>
          {!testing && (testState.error || testState.message) ? (
            <p
              role={testState.error ? "alert" : "status"}
              className={cn(
                "text-sm",
                testState.error ? "text-red-600" : testState.warning ? "text-amber-700" : "text-emerald-700",
              )}
            >
              {testState.error ?? testState.message}
            </p>
          ) : null}
        </form>

        {secondaryActions ? <div className="ml-auto flex items-center gap-1">{secondaryActions}</div> : null}
      </div>
    </>
  );
}

function SaveStatus({ saving, dirty, saved }: { saving: boolean; dirty: boolean; saved: boolean }) {
  if (saving) return null;
  if (dirty) {
    return (
      <span className="flex items-center gap-2 text-sm text-amber-700" role="status">
        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
        Unsaved changes
      </span>
    );
  }
  if (saved) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-emerald-700" role="status">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.58l7.3-7.3a1 1 0 011.4 0z"
            clipRule="evenodd"
          />
        </svg>
        Saved
      </span>
    );
  }
  return null;
}
