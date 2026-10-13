"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Field, Input, Textarea } from "@/components/ui/form";
import type { FormField } from "@/db/schema";
import type { ListRef } from "@/lib/contacts/queries";
import { slugifyFieldKey } from "@/lib/contacts/validation";
import { BUILT_IN_FIELDS, FORM_DEFAULTS, MAX_FORM_FIELDS } from "@/lib/forms/validation";
import type { FormEditorState } from "./actions";

export interface FormEditorValues {
  name: string;
  title: string;
  description: string;
  buttonText: string;
  fields: FormField[];
  listIds: string[];
  tags: string[];
  doubleOptIn: boolean;
  successMessage: string;
  redirectUrl: string;
  active: boolean;
}

export const NEW_FORM: FormEditorValues = {
  name: "",
  title: FORM_DEFAULTS.title,
  description: "",
  buttonText: FORM_DEFAULTS.buttonText,
  fields: [],
  listIds: [],
  tags: [],
  doubleOptIn: true,
  successMessage: FORM_DEFAULTS.successMessage,
  redirectUrl: "",
  active: true,
};

interface CustomRow {
  id: number;
  label: string;
  key: string;
  /** The field name was typed by hand, so stop deriving it from the label. */
  keyEdited: boolean;
  required: boolean;
}

type BuiltInKey = (typeof BUILT_IN_FIELDS)[number]["key"];
type BuiltInState = Record<BuiltInKey, { on: boolean; required: boolean }>;

const BUILT_IN_KEYS: readonly string[] = BUILT_IN_FIELDS.map((f) => f.key);
const checkbox = "h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600";
const optional = <span className="font-normal text-slate-400"> (optional)</span>;

/** Create / edit form for a sign-up form. */
export function FormEditor({
  action,
  lists,
  initial = NEW_FORM,
  submitLabel,
  pendingLabel,
  cancelHref,
}: {
  action: (state: FormEditorState, formData: FormData) => Promise<FormEditorState>;
  lists: ListRef[];
  initial?: FormEditorValues;
  submitLabel: string;
  pendingLabel: string;
  cancelHref?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [builtIn, setBuiltIn] = useState<BuiltInState>(() => {
    const find = (key: string) => initial.fields.find((f) => f.key === key);
    return {
      first_name: { on: Boolean(find("first_name")), required: Boolean(find("first_name")?.required) },
      last_name: { on: Boolean(find("last_name")), required: Boolean(find("last_name")?.required) },
    };
  });
  const [rows, setRows] = useState<CustomRow[]>(() =>
    initial.fields
      .filter((f) => !BUILT_IN_KEYS.includes(f.key))
      .map((f, id) => ({ id, label: f.label, key: f.key, keyEdited: true, required: f.required })),
  );

  const fields: FormField[] = [
    ...BUILT_IN_FIELDS.filter((f) => builtIn[f.key].on).map((f) => ({
      key: f.key,
      label: f.label,
      required: builtIn[f.key].required,
    })),
    ...rows
      .filter((r) => r.label.trim() || r.key.trim())
      .map((r) => ({ key: r.key.trim(), label: r.label.trim(), required: r.required })),
  ];

  // Submit manually rather than via <form action>: React resets uncontrolled
  // inputs after a form action, which would wipe what was typed on an error.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  }

  function updateRow(id: number, patch: Partial<CustomRow>) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">Form saved.</Alert> : null}
      <input type="hidden" name="fields" value={JSON.stringify(fields)} />

      <Field label="Name" htmlFor="form-name" error={errors.name} hint="For your team - visitors don't see it.">
        <Input id="form-name" name="name" required maxLength={100} defaultValue={initial.name} placeholder="e.g. Website footer" />
      </Field>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-900">What visitors see</legend>
        <Field label="Title" htmlFor="form-title" error={errors.title}>
          <Input id="form-title" name="title" required maxLength={120} defaultValue={initial.title} />
        </Field>
        <Field label={<>Description{optional}</>} htmlFor="form-description" error={errors.description}>
          <Textarea
            id="form-description"
            name="description"
            rows={2}
            maxLength={500}
            defaultValue={initial.description}
            placeholder="What will people get, and how often?"
          />
        </Field>
        <Field label="Button text" htmlFor="form-button" error={errors.buttonText} className="max-w-xs">
          <Input id="form-button" name="buttonText" required maxLength={40} defaultValue={initial.buttonText} />
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-900">Fields</legend>
        <p className="text-sm text-slate-500">Email is always asked. Add more only if you need them - shorter forms get more sign-ups.</p>
        {errors.fields ? <p className="text-xs text-red-600">{errors.fields}</p> : null}
        <div className="divide-y divide-slate-100 rounded-md ring-1 ring-inset ring-slate-200">
          {BUILT_IN_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className={checkbox}
                  checked={builtIn[f.key].on}
                  onChange={(e) => setBuiltIn((s) => ({ ...s, [f.key]: { ...s[f.key], on: e.target.checked } }))}
                />
                {f.label}
              </label>
              {builtIn[f.key].on ? (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className={checkbox}
                    checked={builtIn[f.key].required}
                    onChange={(e) => setBuiltIn((s) => ({ ...s, [f.key]: { ...s[f.key], required: e.target.checked } }))}
                  />
                  Required
                </label>
              ) : null}
            </div>
          ))}
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-end gap-3 px-3 py-2.5">
              <div className="min-w-40 flex-1 space-y-1">
                <label htmlFor={`field-label-${row.id}`} className="block text-xs font-medium text-slate-600">
                  Label
                </label>
                <Input
                  id={`field-label-${row.id}`}
                  value={row.label}
                  maxLength={60}
                  placeholder="e.g. Company"
                  onChange={(e) =>
                    updateRow(row.id, {
                      label: e.target.value,
                      ...(row.keyEdited ? {} : { key: e.target.value.trim() ? slugifyFieldKey(e.target.value) : "" }),
                    })
                  }
                />
              </div>
              <div className="min-w-32 flex-1 space-y-1">
                <label htmlFor={`field-key-${row.id}`} className="block text-xs font-medium text-slate-600">
                  Saved as contact field
                </label>
                <Input
                  id={`field-key-${row.id}`}
                  value={row.key}
                  maxLength={50}
                  placeholder="company"
                  className="font-mono"
                  onChange={(e) => updateRow(row.id, { key: e.target.value, keyEdited: true })}
                />
              </div>
              <label className="flex h-9 items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className={checkbox}
                  checked={row.required}
                  onChange={(e) => updateRow(row.id, { required: e.target.checked })}
                />
                Required
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mb-0.5"
                aria-label={`Remove field ${row.label || row.key}`}
                onClick={() => setRows((current) => current.filter((r) => r.id !== row.id))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        {fields.length < MAX_FORM_FIELDS ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setRows((current) => [
                ...current,
                { id: Math.max(-1, ...current.map((r) => r.id)) + 1, label: "", key: "", keyEdited: false, required: false },
              ])
            }
          >
            Add a field
          </Button>
        ) : null}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-900">New subscribers</legend>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-700">Add to lists</p>
          {lists.length === 0 ? (
            <p className="text-sm text-slate-500">You have no lists yet - subscribers will only be added to your contacts.</p>
          ) : (
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {lists.map((list) => (
                <label key={list.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="listIds"
                    value={list.id}
                    defaultChecked={initial.listIds.includes(list.id)}
                    className={checkbox}
                  />
                  <span className="truncate">{list.name}</span>
                </label>
              ))}
            </div>
          )}
          {errors.listIds ? <p className="text-xs text-red-600">{errors.listIds}</p> : null}
        </div>
        <Field label={<>Tags{optional}</>} htmlFor="form-tags" error={errors.tags} hint="Separate tags with commas, e.g. website, webinar-2026">
          <Input id="form-tags" name="tags" maxLength={2000} defaultValue={initial.tags.join(", ")} />
        </Field>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="doubleOptIn" defaultChecked={initial.doubleOptIn} className={`${checkbox} mt-0.5`} />
          <span className="text-sm">
            <span className="font-medium text-slate-700">Double opt-in</span>
            <span className="block text-slate-500">
              People get an email and must click a link before they are subscribed. Keeps fake and mistyped addresses off your lists.
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-900">After signing up</legend>
        <Field
          label="Success message"
          htmlFor="form-success"
          error={errors.successMessage}
          hint="Shown once someone is subscribed (with double opt-in: after they click the link in the email)."
        >
          <Input id="form-success" name="successMessage" required maxLength={300} defaultValue={initial.successMessage} />
        </Field>
        <Field
          label={<>Redirect URL{optional}</>}
          htmlFor="form-redirect"
          error={errors.redirectUrl}
          hint="Send people to your own page after they submit the form."
        >
          <Input
            id="form-redirect"
            name="redirectUrl"
            type="url"
            maxLength={500}
            defaultValue={initial.redirectUrl}
            placeholder="https://www.example.com/thanks"
          />
        </Field>
      </fieldset>

      <label className="flex items-start gap-3">
        <input type="checkbox" name="active" defaultChecked={initial.active} className={`${checkbox} mt-0.5`} />
        <span className="text-sm">
          <span className="font-medium text-slate-700">Active</span>
          <span className="block text-slate-500">Turn off to stop accepting sign-ups without deleting the form.</span>
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {cancelHref ? (
          <ButtonLink href={cancelHref} variant="secondary">
            Cancel
          </ButtonLink>
        ) : null}
      </div>
    </form>
  );
}
