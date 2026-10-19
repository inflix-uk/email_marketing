import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/layout";
import { requireSession } from "@/lib/auth";
import { ComposeForm } from "../_components/compose-form";
import { getComposeData } from "../_lib/compose-data";
import { firstParam } from "../_lib/queries";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string | string[]; templateId?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedTemplateId = firstParam(params.template) ?? firstParam(params.templateId);
  const [session, data] = await Promise.all([requireSession(), getComposeData(undefined, requestedTemplateId)]);
  const initialSubject = data.designs.find((d) => d.value === data.initialDesign)?.subject ?? "";

  return (
    <>
      <PageHeader
        back={
          <Link href="/campaigns" className="font-medium text-slate-500 hover:text-slate-700">
            &larr; Campaigns
          </Link>
        }
        title="New campaign"
      />
      <ComposeForm
        campaignId={null}
        initialSubject={initialSubject}
        scheduledAt={null}
        data={data}
        defaultTestTo={session.email}
      />
    </>
  );
}
