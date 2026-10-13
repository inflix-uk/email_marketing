"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { Badge, Table, TBody, Td, Th } from "@/components/ui/layout";
import { addTeammate, newInviteLink, type InviteLink, type TeamFormState } from "./actions";

// ---------------------------------------------------------------------------
// The "set your password" link, shown once
// ---------------------------------------------------------------------------

function InviteLinkBox({ link, linkDays }: { link: InviteLink; linkDays: number }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
    } catch {
      // Clipboard access blocked: select the text so Ctrl+C works.
      inputRef.current?.select();
      return;
    }
    setCopied(true);
  }

  const intro =
    link.emailed === "sent"
      ? `We emailed ${link.email} a link to set their password. You can also send it yourself:`
      : link.emailed === "failed"
        ? `The email to ${link.email} could not be sent. Send them this link yourself:`
        : `No email provider is connected, so nothing was emailed. Send ${link.email} this link yourself:`;

  return (
    <Alert tone={link.emailed === "sent" ? "success" : "warning"}>
      <p>{intro}</p>
      <div className="mt-2 flex gap-2">
        <Input
          ref={inputRef}
          readOnly
          value={link.url}
          aria-label="Link to set a password"
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p className="mt-2 text-xs">
        It works once, for {linkDays} days. Copy it now - it won&apos;t be shown again.
      </p>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Add teammate
// ---------------------------------------------------------------------------

export function AddTeammateForm({ linkDays }: { linkDays: number }) {
  const [state, dispatch, pending] = useActionState<TeamFormState, FormData>(addTeammate, {});

  // Submitted through a transition rather than <form action>, so a validation
  // error doesn't wipe what was typed (React resets forms after an action).
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  }

  return (
    <div className="space-y-4">
      {state.link ? <InviteLinkBox key={state.link.url} link={state.link} linkDays={linkDays} /> : null}
      {/* Re-mount (clearing the fields) once a teammate was added. `action` is the no-JavaScript fallback. */}
      <form key={state.link?.url ?? "new"} action={dispatch} onSubmit={onSubmit} className="space-y-4">
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" htmlFor="teammate-email" error={state.fieldErrors?.email}>
            <Input id="teammate-email" name="email" type="email" autoComplete="off" placeholder="sam@example.com" required />
          </Field>
          <Field label="Name" htmlFor="teammate-name" error={state.fieldErrors?.name}>
            <Input id="teammate-name" name="name" autoComplete="off" maxLength={100} placeholder="Sam Taylor" />
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding..." : "Add teammate"}
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team table
// ---------------------------------------------------------------------------

export interface TeamRow {
  id: string;
  email: string;
  name: string | null;
  /** Already formatted on the server. */
  added: string;
  /** Invited, hasn't set a password yet. */
  pending: boolean;
  isYou: boolean;
}

function Row({ row, canRemove, linkDays }: { row: TeamRow; canRemove: boolean; linkDays: number }) {
  const [state, dispatch, pending] = useActionState<TeamFormState, FormData>(newInviteLink, {});

  return (
    <>
      <tr>
        <Td>
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{row.email}</span>
            {row.isYou ? <Badge tone="indigo">You</Badge> : null}
            {row.pending ? <Badge tone="yellow">Invited</Badge> : null}
          </span>
        </Td>
        <Td>{row.name || "—"}</Td>
        <Td className="whitespace-nowrap">{row.added}</Td>
        <Td>
          <div className="flex items-center justify-end gap-2">
            {row.pending ? (
              <form action={dispatch}>
                <input type="hidden" name="id" value={row.id} />
                <Button type="submit" variant="secondary" size="sm" disabled={pending}>
                  {pending ? "Creating..." : "New link"}
                </Button>
              </form>
            ) : null}
            {!row.isYou && canRemove ? (
              <ButtonLink href={`/settings/team?remove=${row.id}`} variant="ghost" size="sm" className="text-red-700">
                Remove
              </ButtonLink>
            ) : null}
          </div>
        </Td>
      </tr>
      {state.link || state.error ? (
        <tr>
          <td colSpan={4} className="px-4 pb-4">
            {state.link ? (
              <InviteLinkBox key={state.link.url} link={state.link} linkDays={linkDays} />
            ) : (
              <Alert tone="error">{state.error}</Alert>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function TeamTable({ rows, linkDays }: { rows: TeamRow[]; linkDays: number }) {
  const canRemove = rows.length > 1;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Email</Th>
          <Th>Name</Th>
          <Th>Added</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <TBody>
        {rows.map((row) => (
          <Row key={row.id} row={row} canRemove={canRemove} linkDays={linkDays} />
        ))}
      </TBody>
    </Table>
  );
}
