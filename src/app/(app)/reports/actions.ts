"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { parseReportQuery, reportQueryString } from "@/lib/reports/rollup";
import { deleteReport, saveReport, userIdForEmail } from "@/lib/reports/saved";

export interface SaveReportState {
  ok?: boolean;
  error?: string;
}

const saveSchema = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(80, "Use 80 characters or fewer."),
  query: z.string().max(2000),
});

export async function saveReportAction(_prev: SaveReportState, formData: FormData): Promise<SaveReportState> {
  const session = await requireSession();
  const parsed = saveSchema.safeParse({ name: formData.get("name") ?? "", query: formData.get("query") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ownerId = await userIdForEmail(session.email);
  if (!ownerId) return { error: "Your account was not found." };

  // Re-parse so only known settings are stored.
  const query = reportQueryString(parseReportQuery(Object.fromEntries(new URLSearchParams(parsed.data.query))));
  await saveReport(ownerId, parsed.data.name, query);
  revalidatePath("/reports");
  return { ok: true };
}

export async function deleteReportAction(id: string): Promise<void> {
  const session = await requireSession();
  const parsedId = z.string().min(1).max(100).safeParse(id);
  if (!parsedId.success) return;
  const ownerId = await userIdForEmail(session.email);
  if (!ownerId) return;
  await deleteReport(ownerId, parsedId.data);
  revalidatePath("/reports");
}
