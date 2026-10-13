"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import type { ListRef } from "@/lib/contacts/queries";
import { cn } from "@/lib/utils";
import type { ContactFormState } from "../actions";
import { TagEditor } from "./tag-editor";

export interface ContactFormValues {
  email: string;
  firstName: string | null;
  lastName: string | null;
  fields: Record<string, string>;
  listIds: string[];
  tags: string[];
}

interface FieldRow {
  id: number;
  key: string;
  value: string;
}

const EMPTY: ContactFormValues = { email: "", firstName: null, lastName: null, fields: {}, listIds: [], tags: [] };

/**
 * Create / edit form for a contact: email, names, custom fields, list
 * memberships and tags. Subscription status is managed separately on the contact page.
 */
export function ContactForm({
  action,
  lists,
  initial = EMPTY,
  knownTags,
  submitLabel,
  pendingLabel,
  cancelHref,
}: {
  action: (state: ContactFormState, formData: FormData) => Promise<ContactFormState>;
  lists: ListRef[];
  initial?: ContactFormValues;
  /** Tags already in use, suggested while typing. */
  knownTags?: string[];
  submitLabel: string;
  pendingLabel: string;
  cancelHref: string;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [rows, setRows] = useState<FieldRow[]>(() =>
    Object.entries(initial.fields).map(([key, value], id) => ({ id, key, value })),
  );

  // Submit manually rather than via <form action>: React resets uncontrolled
  // inputs after a form action, which would wipe what was typed on an error.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  }

  function addRow() {
    setRows((current) => [...current, { id: Math.max(-1, ...current.map((r) => r.id)) + 1, key: "", value: "" }]);
  }

  function updateRow(id: number, patch: Partial<FieldRow>) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {state.error ? (
        <Alert tone="error">
          {state.error}
          {state.conflictId ? (
            <>
              {" "}
              <Link href={`/contacts/${state.conflictId}`} className="font-medium underline">
                View the existing contact
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}
      {state.ok ? <Alert tone="success">Changes saved.</Alert> : null}

      <Card>
        <CardHeader title="Details" />
        <CardBody className="space-y-4">
          <Field label="Email address" htmlFor="email" error={errors.email}>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="off"
              defaultValue={initial.email}
              placeholder="name@example.com"
              aria-invalid={errors.email ? true : undefined}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="firstName" error={errors.firstName}>
              <Input id="firstName" name="firstName" autoComplete="off" defaultValue={initial.firstName ?? ""} />
            </Field>
            <Field label="Last name" htmlFor="lastName" error={errors.lastName}>
              <Input id="lastName" name="lastName" autoComplete="off" defaultValue={initial.lastName ?? ""} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Custom fields"
          description={
            <>
              Extra details you can use in emails, e.g. <code className="font-mono text-xs">{"{{company}}"}</code>.
            </>
          }
        />
        <CardBody className="space-y-3">
          {rows.length === 0 ? <p className="text-sm text-slate-500">No custom fields.</p> : null}
          {rows.map((row, index) => (
            <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor={`field-key-${row.id}`} className="sr-only">
                Field {index + 1} name
              </label>
              <Input
                id={`field-key-${row.id}`}
                name="fieldKey"
                value={row.key}
                onChange={(e) => updateRow(row.id, { key: e.target.value })}
                placeholder="Field name, e.g. company"
                className="font-mono sm:w-56"
                autoComplete="off"
              />
              <label htmlFor={`field-value-${row.id}`} className="sr-only">
                Field {index + 1} value
              </label>
              <Input
                id={`field-value-${row.id}`}
                name="fieldValue"
                value={row.value}
                onChange={(e) => updateRow(row.id, { value: e.target.value })}
                placeholder="Value"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows((current) => current.filter((r) => r.id !== row.id))}
                aria-label={`Remove field ${row.key || index + 1}`}
                className="self-end sm:self-auto"
              >
                Remove
              </Button>
            </div>
          ))}
          {errors.fields ? <p className="text-xs text-red-600">{errors.fields}</p> : null}
          <Button type="button" variant="secondary" size="sm" onClick={addRow}>
            + Add field
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Lists" description="Campaigns are sent to lists. Pick the lists this contact belongs to." />
        <CardBody>
          {lists.length === 0 ? (
            <p className="text-sm text-slate-500">
              You don&apos;t have any lists yet.{" "}
              <Link href="/lists" className="font-medium text-indigo-600 hover:text-indigo-500">
                Create a list
              </Link>{" "}
              to group your contacts.
            </p>
          ) : (
            <fieldset>
              <legend className="sr-only">Lists</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {lists.map((list) => (
                  <label
                    key={list.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-700 ring-1 ring-inset ring-slate-200",
                      "hover:bg-slate-50 has-[:checked]:bg-indigo-50 has-[:checked]:ring-indigo-200",
                    )}
                  >
                    <input
                      type="checkbox"
                      name="listIds"
                      value={list.id}
                      defaultChecked={initial.listIds.includes(list.id)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                    />
                    <span className="truncate">{list.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Tags" description="Free-form labels, e.g. vip or webinar-2026." />
        <CardBody>
          <TagEditor initial={initial.tags} suggestions={knownTags} error={errors.tags} />
        </CardBody>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
