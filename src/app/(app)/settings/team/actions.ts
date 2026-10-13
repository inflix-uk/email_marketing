"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  endSession,
  inviteTeammate,
  removeTeammate,
  renewInviteLink,
  requireSession,
  sendPasswordLinkEmail,
  signOutEverywhere,
} from "@/lib/auth";
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
  fieldErrors?: { email?: string[]; name?: string[] };
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
});

export async function addTeammate(_prev: TeamFormState, formData: FormData): Promise<TeamFormState> {
  await requireSession();
  const parsed = addSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const { email, name } = parsed.data;

  const link = await inviteTeammate(email, name || null);
  if (!link) return { fieldErrors: { email: ["This person already has an account."] } };

  revalidatePath(TEAM_PATH);
  return { link: { url: link.url, email, emailed: await emailInvite(email, link.url) } };
}

/** A fresh link for a teammate who hasn't set a password yet. The earlier link stops working. */
export async function newInviteLink(_prev: TeamFormState, formData: FormData): Promise<TeamFormState> {
  await requireSession();
  const link = await renewInviteLink(String(formData.get("id") ?? ""));
  if (!link) {
    revalidatePath(TEAM_PATH);
    return { error: "This person has already set a password (or was removed)." };
  }
  return { link: { url: link.url, email: link.email, emailed: await emailInvite(link.email, link.url) } };
}

/** Second step of "Remove" (the page shows the confirmation first). */
export async function removeTeammateAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const error = await removeTeammate(String(formData.get("id") ?? ""), session.email);
  revalidatePath(TEAM_PATH);
  redirect(`${TEAM_PATH}?notice=${error ?? "removed"}`);
}

/** Sign the current user out on every device, this one included. */
export async function signOutEverywhereAction(): Promise<void> {
  const session = await requireSession();
  await signOutEverywhere(session.email);
  await endSession();
  redirect("/login");
}
