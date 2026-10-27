"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { collections } from "@/db";
import { audit } from "@/lib/audit";
import {
  endSession,
  inviteTeammate,
  removeTeammate,
  renewInviteLink,
  requirePermission,
  requireSession,
  sendPasswordLinkEmail,
  setTeammateRole,
  signOutEverywhere,
} from "@/lib/auth";
import { ROLE_LABELS, ROLES } from "@/lib/permissions";
import { getSettings, isDevMailer } from "@/lib/settings";
import { isValidEmail, normalizeEmail } from "@/lib/utils";

const TEAM_PATH = "/settings/team";

/** A "set your password" link, shown once so it can be copied. */
export interface InviteLink {
  url: string;
  email: string;
  /** sent = also emailed; none = no email provider connected; failed = the email could not be sent. */
  emailed: "sent" | "none" | "failed";
}

export interface TeamFormState {
  error?: string;
  fieldErrors?: { email?: string[]; name?: string[]; role?: string[] };
  link?: InviteLink;
}

/** Email the link when an email provider is connected (in test mode it is only shown on screen). */
async function emailInvite(to: string, url: string): Promise<InviteLink["emailed"]> {
  if (isDevMailer(await getSettings())) return "none";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sendPasswordLinkEmail(to, url, "invite"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The mail server did not respond within 20 seconds")), 20_000);
      }),
    ]);
    return "sent";
  } catch (err) {
    console.error("[team] could not email the invite:", err instanceof Error ? err.message : err);
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

const addSchema = z.object({
  email: z.string().trim().max(320, "That email is too long").refine(isValidEmail, "Enter a valid email address").transform(normalizeEmail),
  name: z.string().trim().max(100, "Keep the name under 100 characters"),
  role: z.enum(ROLES, "Choose a role"),
});

export async function addTeammate(_prev: TeamFormState, formData: FormData): Promise<TeamFormState> {
  const session = await requirePermission("team");
  const parsed = addSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    role: String(formData.get("role") || "editor"),
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const { email, name, role } = parsed.data;

  const link = await inviteTeammate(email, name || null, role);
  if (!link) return { fieldErrors: { email: ["This person already has an account."] } };
  await audit(session, "team.invite", { type: "user", details: { email, role } });

  revalidatePath(TEAM_PATH);
  return { link: { url: link.url, email, emailed: await emailInvite(email, link.url) } };
}

/** A fresh link for a teammate who hasn't set a password yet. The earlier link stops working. */
export async function newInviteLink(_prev: TeamFormState, formData: FormData): Promise<TeamFormState> {
  const session = await requirePermission("team");
  const id = String(formData.get("id") ?? "");
  const link = await renewInviteLink(id);
  if (!link) {
    revalidatePath(TEAM_PATH);
    return { error: "This person has already set a password (or was removed)." };
  }
  await audit(session, "team.new_link", { type: "user", id, details: { email: link.email } });
  return { link: { url: link.url, email: link.email, emailed: await emailInvite(link.email, link.url) } };
}

/** Second step of "Remove" (the page shows the confirmation first). */
export async function removeTeammateAction(formData: FormData): Promise<void> {
  const session = await requirePermission("team");
  const id = String(formData.get("id") ?? "");
  // Look the email up first: once removed, the log would only have an id nobody can read.
  const { users } = await collections();
  const target = id ? await users.findOne({ _id: id }, { projection: { email: 1 } }) : null;
  const error = await removeTeammate(id, session.email);
  if (!error) await audit(session, "team.remove", { type: "user", id, details: target ? { email: target.email } : null });
  revalidatePath(TEAM_PATH);
  redirect(`${TEAM_PATH}?notice=${error ?? "removed"}`);
}

export interface RoleFormState {
  error?: string;
  message?: string;
}

const ROLE_ERRORS = {
  self: "You can't change your own role.",
  "last-admin": "There must always be at least one admin.",
  gone: "That person was removed.",
} as const;

const roleSchema = z.object({ id: z.string().min(1).max(100), role: z.enum(ROLES, "Choose a role") });

/** Change a teammate's role. Applies on their next click (roles are read from the database). */
export async function changeRoleAction(_prev: RoleFormState, formData: FormData): Promise<RoleFormState> {
  const session = await requirePermission("team");
  const parsed = roleSchema.safeParse({ id: formData.get("id"), role: formData.get("role") });
  if (!parsed.success) return { error: "Choose a role." };
  const { id, role } = parsed.data;

  const result = await setTeammateRole(id, role, session.email);
  revalidatePath(TEAM_PATH);
  if ("error" in result) return { error: ROLE_ERRORS[result.error] };
  if (result.previous !== role) {
    await audit(session, "team.role", { type: "user", id, details: { email: result.email, from: result.previous, to: role } });
  }
  return { message: `Now ${ROLE_LABELS[role].toLowerCase()}.` };
}

/** Sign the current user out on every device, this one included. */
export async function signOutEverywhereAction(): Promise<void> {
  const session = await requireSession();
  await signOutEverywhere(session.email);
  await endSession();
  redirect("/login");
}
