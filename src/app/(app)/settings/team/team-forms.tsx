"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Input } from "@/components/ui/form";
import { Badge, Table, TBody, Td } from "@/components/ui/layout";
import { Select } from "@/components/ui/select";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from "@/lib/permissions";
import {
  addTeammate,
  changeRoleAction,
  newInviteLink,
  type InviteLink,
  type RoleFormState,
  type TeamFormState,
} from "./actions";

function RoleOptions() {
  return (
    <>
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </>
  );
}

/** What each role can do, in one short list. */
export function RoleHelp() {
  return (
    <ul className="space-y-1 text-xs text-slate-500">
      {ROLES.map((r) => (
        <li key={r}>
          <span className="font-medium text-slate-700">{ROLE_LABELS[r]}:</span> {ROLE_DESCRIPTIONS[r]}
        </li>
      ))}
    </ul>
  );
}

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
        : `Email sending isn't set up, so send ${link.email} this link yourself:`;

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
      <p className="mt-2 text-xs">Works once, for {linkDays} days. It won&apos;t be shown again.</p>
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

  const emailError = state.fieldErrors?.email?.[0];

  return (
    <div className="space-y-4">
      {state.link ? <InviteLinkBox key={state.link.url} link={state.link} linkDays={linkDays} /> : null}
      {/* Re-mount (clearing the field) once someone was added. `action` is the no-JavaScript fallback. */}
      <form key={state.link?.url ?? "new"} action={dispatch} onSubmit={onSubmit} className="space-y-1.5">
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            name="email"
            type="email"
            autoComplete="off"
            placeholder="sam@yourcompany.com"
            aria-label="Email"
            aria-invalid={emailError ? true : undefined}
            className="min-w-0 flex-1"
            required
          />
          <Select name="role" defaultValue="editor" aria-label="Role" className="sm:w-32">
            <RoleOptions />
          </Select>
          <Button type="submit" disabled={pending}>
            {pending ? "Adding..." : "Add"}
          </Button>
        </div>
        {emailError ? <p className="text-xs text-red-600">{emailError}</p> : null}
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
  /** Invited, hasn't set a password yet. */
  pending: boolean;
  isYou: boolean;
  role: Role;
}

/** Changes the role as soon as another one is picked. */
function RolePicker({ row }: { row: TeamRow }) {
  const [state, dispatch, pending] = useActionState<RoleFormState, FormData>(changeRoleAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={dispatch} className="flex items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <Select
        name="role"
        defaultValue={row.role}
        aria-label={`Role for ${row.email}`}
        disabled={pending}
        className="w-28"
        onChange={() => formRef.current?.requestSubmit()}
      >
        <RoleOptions />
      </Select>
      {state.error ? <span className="text-xs text-red-600">{state.error}</span> : null}
      {state.message && !pending ? <span className="text-xs text-emerald-700">Saved</span> : null}
    </form>
  );
}

function Row({
  row,
  canRemove,
  linkDays,
  manage,
}: {
  row: TeamRow;
  canRemove: boolean;
  linkDays: number;
  manage: boolean;
}) {
  const [state, dispatch, pending] = useActionState<TeamFormState, FormData>(newInviteLink, {});

  return (
    <>
      <tr>
        <Td>
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{row.email}</span>
            {row.name ? <span className="text-slate-500">{row.name}</span> : null}
            {row.isYou ? <Badge tone="indigo">You</Badge> : null}
            {row.pending ? <Badge tone="yellow">Invited</Badge> : null}
          </span>
        </Td>
        <Td>
          {manage && !row.isYou ? (
            <RolePicker key={row.role} row={row} />
          ) : (
            <span className="text-slate-600">{ROLE_LABELS[row.role]}</span>
          )}
        </Td>
        <Td>
          <div className="flex items-center justify-end gap-2">
            {manage && row.pending ? (
              <form action={dispatch}>
                <input type="hidden" name="id" value={row.id} />
                <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                  {pending ? "Creating..." : "New link"}
                </Button>
              </form>
            ) : null}
            {manage && !row.isYou && canRemove ? (
              <ButtonLink href={`/settings/team?remove=${row.id}`} variant="ghost" size="sm" className="text-red-700">
                Remove
              </ButtonLink>
            ) : null}
          </div>
        </Td>
      </tr>
      {state.link || state.error ? (
        <tr>
          <td colSpan={3} className="px-4 pb-4">
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

export function TeamTable({ rows, linkDays, manage }: { rows: TeamRow[]; linkDays: number; manage: boolean }) {
  const canRemove = rows.length > 1;
  return (
    <Table>
      <TBody>
        {rows.map((row) => (
          <Row key={row.id} row={row} canRemove={canRemove} linkDays={linkDays} manage={manage} />
        ))}
      </TBody>
    </Table>
  );
}
