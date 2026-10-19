import { collections } from "@/db";
import { fromDoc, type Campaign } from "@/db/schema";
import { countRecipients } from "@/lib/sending";
import { STARTER_TEMPLATES } from "@/lib/starter-templates";
import { getListsWithCounts, type ListOption } from "./queries";
import { CURRENT_DESIGN, starterValue, templateValue } from "./starting-points";

/** One choice in the campaign's design picker. */
export interface DesignOption {
  value: string;
  name: string;
  /** Suggested subject (filled in when the subject is still empty). */
  subject: string;
  html: string;
  /** Saved templates can be opened for editing. */
  templateId: string | null;
}

export interface ComposeData {
  designs: DesignOption[];
  initialDesign: string;
  lists: ListOption[];
  initialListIds: string[];
  initialRecipients: number;
}

/** Saved templates offered in the picker (most recently edited first). */
const MAX_TEMPLATES = 50;

/** Everything the compose form needs, for a new campaign or an existing draft. */
export async function getComposeData(campaign?: Campaign, requestedTemplateId?: string): Promise<ComposeData> {
  const { templates } = await collections();
  const projection = { name: 1, subject: 1, html: 1 };
  const saved = (await templates.find({}, { projection }).sort({ updatedAt: -1, _id: 1 }).limit(MAX_TEMPLATES).toArray()).map(
    fromDoc,
  );
  // A template linked from the Templates page may be older than the ones listed.
  const wanted = requestedTemplateId ?? campaign?.templateId ?? undefined;
  if (wanted && !saved.some((t) => t.id === wanted)) {
    const doc = await templates.findOne({ _id: wanted }, { projection });
    if (doc) saved.unshift(fromDoc(doc));
  }

  // Your own templates; the built-in designs only until you have some (no duplicates).
  const designs: DesignOption[] = saved.length
    ? saved.map((t) => ({ value: templateValue(t.id), name: t.name, subject: t.subject ?? "", html: t.html, templateId: t.id }))
    : STARTER_TEMPLATES.map((t) => ({ value: starterValue(t.key), name: t.name, subject: t.subject, html: t.html, templateId: null }));

  let initialDesign = designs[0]?.value ?? CURRENT_DESIGN;
  if (campaign) {
    // Pre-select the template the campaign came from (saving copies its latest
    // content), else a design with the same content; otherwise keep the
    // campaign's own content as "Current design".
    const match =
      designs.find((d) => d.templateId && d.templateId === campaign.templateId) ??
      designs.find((d) => d.html === campaign.html);
    if (match) {
      initialDesign = match.value;
    } else {
      designs.unshift({ value: CURRENT_DESIGN, name: "Current design", subject: campaign.subject, html: campaign.html, templateId: null });
      initialDesign = CURRENT_DESIGN;
    }
  } else if (requestedTemplateId && saved.some((t) => t.id === requestedTemplateId)) {
    initialDesign = templateValue(requestedTemplateId);
  }

  const lists = await getListsWithCounts();
  const known = new Set(lists.map((l) => l.id));
  const initialListIds = (campaign?.listIds ?? []).filter((id) => known.has(id));
  const initialRecipients = initialListIds.length ? await countRecipients(initialListIds) : 0;

  return { designs, initialDesign, lists, initialListIds, initialRecipients };
}
