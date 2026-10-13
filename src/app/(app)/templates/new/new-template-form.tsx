"use client";

import { useActionState, useState } from "react";
import { EmailThumbnail } from "@/components/email-editor";
import { ButtonLink, SubmitButton } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { BLANK_STARTER, BLANK_VISUAL_STARTER, TEMPLATE_STARTERS } from "@/lib/templates/starters";
import { cn } from "@/lib/utils";
import { createTemplate, type CreateTemplateState } from "../actions";

function defaultName(key: string): string {
  if (key === BLANK_STARTER.key || key === BLANK_VISUAL_STARTER.key) return "Untitled template";
  return TEMPLATE_STARTERS.find((s) => s.key === key)?.name ?? "";
}

export function NewTemplateForm() {
  const [state, action] = useActionState<CreateTemplateState, FormData>(createTemplate, {});
  const [starter, setStarter] = useState(TEMPLATE_STARTERS[0].key);
  const [name, setName] = useState(() => defaultName(TEMPLATE_STARTERS[0].key));
  // Until the user types a name, follow the chosen starter's name.
  const [nameEdited, setNameEdited] = useState(false);

  function chooseStarter(key: string) {
    setStarter(key);
    if (!nameEdited) setName(defaultName(key));
  }

  return (
    <form action={action} className="space-y-8">
      <fieldset>
        <legend className="text-base font-semibold text-slate-900">Start from</legend>
        <p className="mt-1 text-sm text-slate-500">
          Pick a ready-made design or a blank one to build in the visual editor, or choose Blank (HTML) to write or
          paste your own code. You can change everything afterwards.
        </p>
        {state.fieldErrors?.starter ? (
          <p className="mt-2 text-xs text-red-600">{state.fieldErrors.starter[0]}</p>
        ) : null}

        <div className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          {TEMPLATE_STARTERS.map((option) => (
            <label
              key={option.key}
              className={cn(
                "group relative flex cursor-pointer flex-col overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200 transition-shadow hover:ring-slate-300",
                "has-checked:ring-2 has-checked:ring-indigo-600",
                "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-indigo-600",
              )}
            >
              <input
                type="radio"
                name="starter"
                value={option.key}
                checked={starter === option.key}
                onChange={() => chooseStarter(option.key)}
                className="sr-only"
              />
              <EmailThumbnail html={option.html} className="aspect-[4/3] border-b border-slate-200" />
              <span className="flex-1 p-3">
                <span className="block text-sm font-medium text-slate-900">{option.name}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{option.description}</span>
                <span className="mt-2 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                  {option.design ? "Visual editor" : "HTML editor"}
                </span>
              </span>
              <span
                className="absolute top-2 right-2 hidden h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white shadow group-has-checked:flex"
                aria-hidden
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path
                    fillRule="evenodd"
                    d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.58l7.3-7.3a1 1 0 011.4 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="max-w-md space-y-4">
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <Field label="Template name" htmlFor="name" error={state.fieldErrors?.name} hint="Only you see this.">
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
            maxLength={120}
            required
          />
        </Field>
        <div className="flex gap-2">
          <SubmitButton pendingText="Creating...">Create template</SubmitButton>
          <ButtonLink href="/templates" variant="secondary">
            Cancel
          </ButtonLink>
        </div>
      </div>
    </form>
  );
}
