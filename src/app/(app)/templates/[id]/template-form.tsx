"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { EmailEditor } from "@/components/email-editor";
import { PersonalisationExample, PersonaliseSelect } from "@/components/personalise-select";
import { useCan } from "@/components/role-context";
import { SpamCheckPanel } from "@/components/spam-check-panel";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { saveTemplate, type SaveTemplateState } from "../actions";
import { TestSendDialog, type TemplateTestLogItem } from "./test-send-dialog";

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
  campaign = null,
  testRecipient,
  tests = [],
  secondaryActions,
  fieldKeys = [],
}: {
  /** Custom contact fields offered in "Insert personalisation". */
  fieldKeys?: string[];
  /** The saved version; re-fetched after every save. */
  template: EditableTemplate;
  /** The campaign draft this was opened from ("Edit design"): saving updates it, and there's a way back. */
  campaign?: { id: string; name: string } | null;
  /** Pre-filled test address (the signed-in user). */
  testRecipient: string;
  /** The last few test sends of this template, newest first. */
  tests?: TemplateTestLogItem[];
  /** Quiet actions (duplicate, delete) shown at the end of the bottom row. */
  secondaryActions?: ReactNode;
}) {
  // Viewers may look but not save or send (the server actions refuse them anyway).
  const canEdit = useCan("edit");
  const canSend = useCan("send");
  const [saveState, saveAction, saving] = useActionState<SaveTemplateState, FormData>(saveTemplate, {});

  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject ?? "");
  const [html, setHtml] = useState(template.html);
  const [design, setDesign] = useState(template.design ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  const dirty =
    name.trim() !== template.name ||
    subject.trim() !== (template.subject ?? "") ||
    html !== template.html ||
    design !== (template.design ?? "");

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    if (!canEdit) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit]);

  // Warn before closing / reloading the tab with unsaved changes.
  useEffect(() => {
    if (!dirty || !canEdit) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, canEdit]);

  const errors = saveState.fieldErrors ?? {};

  return (
    <>
      {campaign ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-indigo-50 px-4 py-2.5 ring-1 ring-inset ring-indigo-200">
          <Link
            href={`/campaigns/${campaign.id}`}
            onClick={(event) => {
              if (dirty && canEdit && !window.confirm("Leave without saving your changes?")) event.preventDefault();
            }}
            className="text-sm font-medium text-indigo-700 hover:text-indigo-600"
          >
            ← Back to campaign
          </Link>
          <p className="min-w-0 text-sm text-indigo-900">
            Editing the email for <strong className="font-semibold">{campaign.name}</strong>. Saving updates the campaign too.
          </p>
        </div>
      ) : null}
      <form ref={formRef} action={saveAction} className="space-y-4">
        <input type="hidden" name="id" value={template.id} />
        {campaign ? <input type="hidden" name="campaignId" value={campaign.id} /> : null}

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
          <Field
            label="Subject"
            htmlFor="subject"
            error={errors.subject}
            className="min-w-0 flex-1"
          >
            <div className="flex gap-2">
              <Input
                ref={subjectRef}
                id="subject"
                name="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                placeholder="What's this email about?"
                className="min-w-0 flex-1"
              />
              {canEdit ? (
                <PersonaliseSelect
                  inputRef={subjectRef}
                  fieldKeys={fieldKeys}
                  className="w-48 shrink-0"
                  aria-label="Insert personalisation into the subject"
                />
              ) : null}
            </div>
            {errors.subject ? null : <PersonalisationExample text={subject} />}
          </Field>
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3 lg:pt-[26px]">
              <SaveStatus saving={saving} dirty={dirty} saved={Boolean(saveState.ok)} />
              <Button type="submit" disabled={saving} title="Save (Ctrl+S)">
                {saving ? "Saving..." : "Save"}
              </Button>
              {campaign ? (
                // Saves (which updates the campaign too), then goes back to it.
                <Button type="submit" name="then" value="back" variant="secondary" disabled={saving}>
                  Save and back to campaign
                </Button>
              ) : (
                // Saves first, then creates a campaign draft with this template and opens it.
                <Button type="submit" name="then" value="campaign" variant="secondary" disabled={saving}>
                  Use in campaign
                </Button>
              )}
            </div>
          ) : null}
        </div>

        {saveState.error && !saving ? <Alert tone="error">{saveState.error}</Alert> : null}
        {saveState.warning && !saving ? <Alert tone="warning">{saveState.warning}</Alert> : null}

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

      <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
        {canSend ? (
          <TestSendDialog
            templateId={template.id}
            name={name}
            subject={subject}
            previewText={template.previewText ?? ""}
            html={html}
            defaultTo={testRecipient}
            tests={tests}
          />
        ) : null}
        <SpamCheckPanel
          subject={subject}
          preheader={template.previewText}
          html={html}
          className="min-w-0 flex-1 basis-80"
        />

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
