import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { requireSession } from "@/lib/auth";
import { parseCampaignParam } from "@/lib/campaigns/drafts";
import { can } from "@/lib/permissions";
import { StarterPicker } from "../starter-picker";

export const metadata: Metadata = { title: "New template" };

export default async function NewTemplatePage({
  searchParams,
}: {
  /** ?campaign= : started from a campaign; the new template is used by it. */
  searchParams: Promise<{ campaign?: string | string[] }>;
}) {
  // Viewers can't create templates.
  if (!can((await requireSession()).role, "edit")) redirect("/templates");
  const campaignId = parseCampaignParam((await searchParams).campaign);
  return (
    <>
      <PageHeader
        back={
          <Link href={campaignId ? `/campaigns/${campaignId}` : "/templates"} className="text-slate-500 hover:text-slate-700">
            {campaignId ? "← Back to campaign" : "← Templates"}
          </Link>
        }
        title="New template"
        description="Pick a design, or paste your own HTML."
      />
      <StarterPicker campaignId={campaignId} />
    </>
  );
}
