import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/layout";
import { collections } from "@/db";
import { fromDoc } from "@/db/schema";
import { STARTER_TEMPLATES } from "@/lib/starter-templates";
import { firstParam } from "../_lib/queries";
import { BLANK_HTML, DEFAULT_STARTING_POINT, starterValue, templateValue } from "../_lib/starting-points";
import { NewCampaignForm, type StartingPointOption } from "./new-campaign-form";

export const metadata: Metadata = { title: "New campaign" };

/** Saved templates offered as starting points (most recently edited first). */
const MAX_SAVED_TEMPLATES = 50;

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ templateId?: string | string[] }>;
}) {
  const requestedTemplateId = firstParam((await searchParams).templateId);

  const { templates } = await collections();
  const projection = { name: 1, subject: 1, html: 1 };
  const saved = (
    await templates.find({}, { projection }).sort({ updatedAt: -1, _id: 1 }).limit(MAX_SAVED_TEMPLATES).toArray()
  ).map(fromDoc);

  // A template linked from the Templates page may be older than the ones listed.
  if (requestedTemplateId && !saved.some((t) => t.id === requestedTemplateId)) {
    const requested = await templates.findOne({ _id: requestedTemplateId }, { projection });
    if (requested) saved.unshift(fromDoc(requested));
  }

  const options: StartingPointOption[] = [
    ...saved.map((t) => ({
      value: templateValue(t.id),
      group: "saved" as const,
      name: t.name,
      description: t.subject ? `Subject: ${t.subject}` : "No default subject",
      html: t.html,
    })),
    ...STARTER_TEMPLATES.map((t) => ({
      value: starterValue(t.key),
      group: "starter" as const,
      name: t.name,
      description: t.description,
      html: t.html,
    })),
    {
      value: "blank",
      group: "blank" as const,
      name: "Blank",
      description: "A minimal layout with just an unsubscribe footer. Write your own HTML.",
      html: BLANK_HTML,
    },
  ];

  const initialValue =
    requestedTemplateId && saved.some((t) => t.id === requestedTemplateId)
      ? templateValue(requestedTemplateId)
      : DEFAULT_STARTING_POINT;

  return (
    <>
      <PageHeader
        back={
          <Link href="/campaigns" className="font-medium text-slate-500 hover:text-slate-700">
            &larr; Campaigns
          </Link>
        }
        title="New campaign"
        description="Name your campaign and choose where its content starts from. You can change everything on the next screen."
      />
      <NewCampaignForm options={options} initialValue={initialValue} />
    </>
  );
}
