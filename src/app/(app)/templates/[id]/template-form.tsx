"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { EmailEditor } from "@/components/email-editor";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { MAX_TEST_RECIPIENTS, type TestSender } from "@/lib/templates/recipients";
import { saveTemplate, type SaveTemplateState } from "../actions";
import { sendTemplateTest, type SendTestState } from "./actions";

export interface EditableTemplate {
  id: string;
  name: string;
  subject: string | null;
  previewText: string | null;
  html: string;
  /** Visual-editor design JSON; null = hand-written HTML. */
  design: string | null;
}

export function TemplateForm({
  template,
  testRecipient,
  sender,
}: {
  /** The saved version; re-fetched after every save. */
  template: EditableTemplate;
  testRecipient: string;
  sender: TestSender;
}) {
  const [saveState, saveAction, saving] = useActionState<SaveTemplateState, FormData>(saveTemplate, {});
  const [testState, testAction, testing] = useActionState<SendTestState, FormData>(sendTemplateTest, {});

  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject ?? "");
  const [previewText, setPreviewText] = useState(template.previewText ?? "");
  const [html, setHtml] = useState(template.html);
  const [design, setDesign] = useState(template.design ?? "");
  const [testTo, setTestTo] = useState(testRecipient);
  const formRef = useRef<HTMLFormElement>(null);

  const dirty =
    name.trim() !== template.name ||
    subject.trim() !== (template.subject ?? "") ||
    previewText.trim() !== (template.previewText ?? "") ||
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
      <form ref={formRef} action={saveAction} className="space-y-6">
        <input type="hidden" name="id" value={template.id} />

        <Card>
          <CardBody className="grid gap-4 md:grid-cols-3">
            <Field label="Template name" htmlFor="name" hint="Only you see this." error={errors.name}>
              <Input
                id="name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
              />
            </Field>
            <Field
              label="Default subject"
              htmlFor="subject"
              hint={
                <>
                  Merge tags allowed, e.g. <code className="font-mono">{"{{first_name | there}}"}</code>
                </>
              }
              error={errors.subject}
            >
              <Input
                id="subject"
                name="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                placeholder="What's this email about?"
              />
            </Field>
            <Field
              label="Preview text"
              htmlFor="previewText"
              hint="Shown after the subject in most inboxes."
              error={errors.previewText}
            >
              <Input
                id="previewText"
                name="previewText"
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                maxLength={200}
              />
            </Field>
          </CardBody>
        </Card>

        <div className="space-y-1.5">
          <EmailEditor
            name="html"
            defaultValue={template.html}
            previewText={previewText}
            onChange={setHtml}
            designName="design"
            defaultDesign={template.design}
            onDesignChange={setDesign}
            minHeight={560}
          />
          {errors.html ? <p className="text-xs text-red-600">{errors.html[0]}</p> : null}
        </div>

        <div className="sticky bottom-0 z-20 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          {saveState.error && !saving ? (
            <Alert tone="error" className="mb-3">
              {saveState.error}
            </Alert>
          ) : null}
          <div className="flex items-center justify-end gap-4">
            <SaveStatus saving={saving} dirty={dirty} saved={Boolean(saveState.ok)} />
            <Button type="submit" disabled={saving} title="Save (Ctrl+S)">
              {saving ? "Saving..." : "Save template"}
            </Button>
          </div>
        </div>
      </form>

      <Card className="mt-8">
        <CardHeader
          title="Send a test"
          description={
            sender.email ? (
              <>
                Sends the current version, including unsaved changes, from {sender.name} &lt;{sender.email}&gt;.
              </>
            ) : (
              <>
                Sends the current version, including unsaved changes. Set a default sender email in{" "}
                <Link href="/settings" className="font-medium text-indigo-600 hover:text-indigo-500">
                  Settings
                </Link>{" "}
                first.
              </>
            )
          }
        />
        <CardBody>
          <form
            action={(formData) => {
              formData.set("name", name);
              formData.set("subject", subject);
              formData.set("previewText", previewText);
              formData.set("html", html);
              testAction(formData);
            }}
            className="flex flex-col gap-3 sm:flex-row sm:items-start"
          >
            <Field
              label="Send to"
              htmlFor="test-to"
              hint={`Up to ${MAX_TEST_RECIPIENTS} addresses, separated by commas.`}
              className="flex-1"
            >
              <Input
                id="test-to"
                name="to"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </Field>
            <Button type="submit" variant="secondary" disabled={testing} className="sm:mt-[26px]">
              {testing ? "Sending..." : "Send test"}
            </Button>
          </form>
          {!testing && testState.error ? (
            <Alert tone="error" className="mt-4">
              {testState.error}
            </Alert>
          ) : null}
          {!testing && testState.ok ? (
            <Alert tone="success" className="mt-4">
              {testState.message}
            </Alert>
          ) : null}
        </CardBody>
      </Card>
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
        All changes saved
      </span>
    );
  }
  return null;
}
