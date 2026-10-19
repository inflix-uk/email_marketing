"use client";

import Link from "next/link";
import { startTransition, useActionState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { Card, CardBody } from "@/components/ui/layout";
import type { ListRef } from "@/lib/contacts/queries";
import { cn } from "@/lib/utils";
import type { ContactFormState } from "../actions";

export interface ContactFormValues {
  email: string;
  firstName: string | null;
  lastName: string | null;
  listIds: string[];
}

const EMPTY: ContactFormValues = { email: "", firstName: null, lastName: null, listIds: [] };

/**
 * Add / edit form for a contact: email, names and lists - nothing else.
 * Anything else stored on the contact is kept by the server action.
 */
export function ContactForm({
  action,
  lists,
  initial = EMPTY,
  submitLabel,
  pendingLabel,
}: {
  action: (state: ContactFormState, formData: FormData) => Promise<ContactFormState>;
  lists: ListRef[];
  initial?: ContactFormValues;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [state, dispatch, pending] = useActionState(action, {});

  // Submit manually rather than via <form action>: React resets uncontrolled
  // inputs after a form action, which would wipe what was typed on an error.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  }

  const errors = state.fieldErrors ?? {};

  return (
    <Card>
      <form onSubmit={onSubmit}>
        <CardBody className="space-y-4">
          {state.error ? (
            <Alert tone="error">
              {state.error}
              {state.conflictId ? (
                <>
                  {" "}
                  <Link href={`/contacts/${state.conflictId}`} className="font-medium underline">
                    Open it
                  </Link>
                </>
              ) : null}
            </Alert>
          ) : null}
          {state.ok ? <Alert tone="success">Saved.</Alert> : null}

          <Field label="Email" htmlFor="email" error={errors.email}>
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

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-slate-700">Lists</legend>
            {lists.length === 0 ? (
              <p className="text-sm text-slate-500">
                No lists yet.{" "}
                <Link href="/lists" className="font-medium text-indigo-600 hover:text-indigo-500">
                  Create a list
                </Link>
              </p>
            ) : (
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
            )}
          </fieldset>

          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? pendingLabel : submitLabel}
            </Button>
          </div>
        </CardBody>
      </form>
    </Card>
  );
}
