"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { COLUMN_TARGETS, mapRows, MAX_IMPORT_ROWS, parseCsv, validateMapping, type ColumnMapping } from "@/lib/contacts/import";
import { ImportError, runImport, type ImportOutcome } from "@/lib/contacts/run-import";

export interface ImportResult {
  /** New contacts. */
  added: number;
  /** Existing contacts whose name changed. */
  updated: number;
  /** Existing contacts with nothing new. */
  unchanged: number;
  /** Rows without a valid email address. */
  skipped: number;
  list: { id: string; name: string };
}

export interface ImportState {
  error?: string;
  result?: ImportResult;
}

/** Only email and names are imported; every other column is ignored. */
const IMPORTED_TARGETS = new Set<ColumnMapping["target"]>(["email", "first_name", "last_name", "full_name"]);

const mappingSchema = z.array(z.object({ target: z.enum(COLUMN_TARGETS) }));

const importSchema = z
  .object({
    csv: z.string().min(1, "Choose a CSV file."),
    mapping: z.string().transform((text, ctx) => {
      try {
        return mappingSchema
          .parse(JSON.parse(text))
          .map((m): ColumnMapping => (IMPORTED_TARGETS.has(m.target) ? { target: m.target } : { target: "ignore" }));
      } catch {
        ctx.addIssue({ code: "custom", message: "Please choose the file again." });
        return z.NEVER;
      }
    }),
    /** An existing list... */
    listId: z.string().trim(),
    /** ...or the name of a new one. */
    newListName: z.string().trim().max(100, "Keep the list name under 100 characters."),
  })
  .superRefine((v, ctx) => {
    if (!v.listId && !v.newListName) ctx.addIssue({ code: "custom", message: "Choose a list, or type a name for a new one." });
  });

/**
 * Import a CSV into a list. New people are added as subscribed; people who
 * already exist keep their status (an import never re-subscribes anyone) and
 * only get their names filled in or updated - empty cells never erase anything.
 */
export async function importContactsAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireSession();

  const parsed = importSchema.safeParse({
    csv: String(formData.get("csv") ?? ""),
    mapping: String(formData.get("mapping") ?? ""),
    listId: String(formData.get("listId") ?? ""),
    newListName: String(formData.get("newListName") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  // Re-parse on the server: never trust rows produced by the browser.
  const { headers, rows } = parseCsv(input.csv);
  if (rows.length === 0) return { error: "The file is empty." };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { error: `This file has ${rows.length.toLocaleString("en-GB")} rows. Split it into files of at most ${MAX_IMPORT_ROWS.toLocaleString("en-GB")}.` };
  }
  const mappingError = validateMapping(input.mapping, headers.length);
  if (mappingError) return { error: mappingError };

  const mapped = mapRows(rows, input.mapping);
  if (mapped.contacts.length === 0) return { error: "No row has a valid email address. Check the Email column." };

  let outcome: ImportOutcome;
  try {
    outcome = await runImport(mapped.contacts, {
      listId: input.listId || null,
      newListName: input.listId ? null : input.newListName,
      updateExisting: true,
    });
  } catch (err) {
    if (err instanceof ImportError) return { error: err.message };
    console.error("[contacts import] failed", err);
    return { error: "The import stopped because of an error. It is safe to import the same file again." };
  } finally {
    revalidatePath("/contacts", "layout");
    revalidatePath("/lists", "layout");
  }

  if (!outcome.list) return { error: "Choose a list." }; // can't happen: a list is required above
  return {
    result: {
      added: outcome.created,
      updated: outcome.updated,
      unchanged: outcome.existing - outcome.updated,
      skipped: mapped.invalidCount,
      list: { id: outcome.list.id, name: outcome.list.name },
    },
  };
}
