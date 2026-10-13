"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { EmailPreview } from "@/components/email-editor";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { cn } from "@/lib/utils";
import { createCampaign, type ActionState } from "../actions";

export interface StartingPointOption {
  value: string;
  group: "saved" | "starter" | "blank";
  name: string;
  description: string;
  html: string;
}

const GROUPS: { key: StartingPointOption["group"]; title: string }[] = [
  { key: "saved", title: "Your templates" },
  { key: "starter", title: "Starter templates" },
  { key: "blank", title: "Start from scratch" },
];

export function NewCampaignForm({ options, initialValue }: { options: StartingPointOption[]; initialValue: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createCampaign, {});
  const [selected, setSelected] = useState(initialValue);
  const current = options.find((o) => o.value === selected) ?? options[0];

  // Submit manually so a validation error doesn't reset what was typed.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}

        <Card>
          <CardBody>
            <Field
              label="Campaign name"
              htmlFor="name"
              hint="Only you see this. Pick something you'll recognise later."
              error={state.fieldErrors?.name}
            >
              <Input
                id="name"
                name="name"
                required
                maxLength={200}
                autoFocus
                placeholder="e.g. October newsletter"
                aria-invalid={state.fieldErrors?.name ? true : undefined}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Starting point"
            description="The subject, preview text and content are copied into your campaign, so later changes to the template won't affect it."
          />
          <CardBody>
            <fieldset className="space-y-6">
              <legend className="sr-only">Starting point</legend>
              {state.fieldErrors?.source ? (
                <p className="text-sm text-red-600">{state.fieldErrors.source[0]}</p>
              ) : null}
              {GROUPS.map((group) => {
                const items = options.filter((o) => o.group === group.key);
                return (
                  <div key={group.key}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</h3>
                    {items.length === 0 ? (
                      <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-500">
                        You haven&apos;t saved any templates yet.{" "}
                        <Link href="/templates" className="font-medium text-indigo-600 hover:text-indigo-500">
                          Create one
                        </Link>{" "}
                        to reuse your own design across campaigns.
                      </p>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {items.map((option) => (
                          <OptionCard
                            key={option.value}
                            option={option}
                            checked={option.value === current?.value}
                            onSelect={() => setSelected(option.value)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </fieldset>
          </CardBody>
        </Card>

        <div className="flex justify-end gap-2">
          <ButtonLink href="/campaigns" variant="secondary">
            Cancel
          </ButtonLink>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating..." : "Create campaign"}
          </Button>
        </div>
      </div>

      <aside className="lg:col-span-2" aria-label="Preview">
        <div className="lg:sticky lg:top-6">
          <Card className="overflow-hidden">
            <CardHeader title="Preview" description={current ? current.name : undefined} />
            <div className="bg-slate-50 p-3">
              {current ? <EmailPreview html={current.html} width="mobile" height={560} /> : null}
            </div>
            <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
              Merge tags are filled in with sample data (Jane Doe).
            </p>
          </Card>
        </div>
      </aside>
    </form>
  );
}

function OptionCard({
  option,
  checked,
  onSelect,
}: {
  option: StartingPointOption;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer flex-col rounded-lg border p-4 pr-10 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600",
        checked ? "border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600" : "border-slate-200 bg-white hover:border-slate-300",
      )}
    >
      <input type="radio" name="source" value={option.value} checked={checked} onChange={onSelect} className="sr-only" />
      <span className="text-sm font-medium text-slate-900">{option.name}</span>
      <span className="mt-1 line-clamp-2 text-xs text-slate-500">{option.description}</span>
      <span
        aria-hidden
        className={cn(
          "absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border",
          checked ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white",
        )}
      >
        {checked ? (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.58l7.3-7.3a1 1 0 011.4 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : null}
      </span>
    </label>
  );
}
