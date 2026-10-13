"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import {
  COLUMN_TARGETS,
  mapRows,
  MAX_IMPORT_ROWS,
  parseCsv,
  validateMapping,
  type InvalidRow,
} from "@/lib/contacts/import";
import { ImportError, runImport, type ImportOutcome } from "@/lib/contacts/run-import";
import { parseTags } from "@/lib/contacts/tags";

export interface ImportSummary extends ImportOutcome {
  totalRows: number;
  invalidCount: number;
  invalid: InvalidRow[];
  duplicateCount: number;
  updateExisting: boolean;
  /** Tags added to every contact in the file. */
  tags: string[];
  /** A column was imported as tags, or `tags` isn't empty. */
  usedTags: boolean;
}

export interface ImportState {
  error?: string;
  result?: ImportSummary;
}

const mappingSchema = z.array(
  z.object({
    target: z.enum(COLUMN_TARGETS),
    fieldKey: z.string().trim().optional(),
  }),
);

const importSchema = z
  .object({
    csv: z.string().min(1, "Choose a CSV file to import."),
    mapping: z.string().transform((text, ctx) => {
      try {
        return mappingSchema.parse(JSON.parse(text));
      } catch {
        ctx.addIssue({ code: "custom", message: "The column mapping is invalid - please choose the file again." });
        return z.NEVER;
      }
    }),
    listMode: z.enum(["none", "existing", "new"]),
    listId: z.string().trim(),
    newListName: z.string().trim().max(100, "Keep the list name under 100 characters."),
    updateExisting: z.boolean(),
    /** "Add this tag to every imported contact" (several may be separated by commas). */
    tags: z.string().max(500, "That's too many tags - add at most a few.").transform(parseTags),
  })
  .superRefine((v, ctx) => {
    if (v.listMode === "existing" && !v.listId) ctx.addIssue({ code: "custom", message: "Choose which list to add the contacts to." });
    if (v.listMode === "new" && !v.newListName) ctx.addIssue({ code: "custom", message: "Give the new list a name." });
  });

export async function importContactsAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireSession();

  const parsed = importSchema.safeParse({
    csv: String(formData.get("csv") ?? ""),
    mapping: String(formData.get("mapping") ?? ""),
    listMode: formData.get("listMode"),
    listId: String(formData.get("listId") ?? ""),
    newListName: String(formData.get("newListName") ?? ""),
    updateExisting: formData.get("updateExisting") === "on",
    tags: String(formData.get("tags") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  // Re-parse on the server: never trust rows produced by the browser.
  const { headers, rows } = parseCsv(input.csv);
  if (rows.length === 0) return { error: "The file has no data rows below the header." };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { error: `This file has ${rows.length.toLocaleString("en-GB")} rows - split it into files of at most ${MAX_IMPORT_ROWS.toLocaleString("en-GB")}.` };
  }
  const mappingError = validateMapping(input.mapping, headers.length);
  if (mappingError) return { error: mappingError };

  const mapped = mapRows(rows, input.mapping);
  if (mapped.contacts.length === 0) {
    return { error: "None of the rows has a valid email address. Check that the right column is imported as Email." };
  }

  let outcome: ImportOutcome;
  try {
    outcome = await runImport(mapped.contacts, {
      listId: input.listMode === "existing" ? input.listId : null,
      newListName: input.listMode === "new" ? input.newListName : null,
      updateExisting: input.updateExisting,
      tags: input.tags,
    });
  } catch (err) {
    if (err instanceof ImportError) return { error: err.message };
    console.error("[contacts import] failed", err);
    return {
      error:
        "The import stopped part-way because of an unexpected error. Some contacts may already have been imported - importing the same file again is safe and won't create duplicates.",
    };
  } finally {
    revalidatePath("/contacts", "layout");
    revalidatePath("/lists", "layout");
  }

  return {
    result: {
      ...outcome,
      totalRows: mapped.totalRows,
      invalidCount: mapped.invalidCount,
      invalid: mapped.invalid,
      duplicateCount: mapped.duplicateCount,
      updateExisting: input.updateExisting,
      tags: input.tags,
      usedTags: input.tags.length > 0 || input.mapping.some((m) => m.target === "tags"),
    },
  };
}
