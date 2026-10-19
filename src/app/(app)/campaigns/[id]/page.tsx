import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CampaignSkeleton } from "../_components/skeleton";
import { firstParam, getCampaign, isEditable, parsePage, RECIPIENT_FILTERS, type RecipientFilter } from "../_lib/queries";
import { displaySubject } from "../_lib/display";
import { CampaignEditor } from "./campaign-editor";
import { CampaignReport } from "./campaign-report";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ filter?: string | string[]; page?: string | string[]; notice?: string | string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const campaign = await getCampaign((await params).id);
  return { title: campaign ? displaySubject(campaign.subject) || campaign.name : "Campaign not found" };
}

export default async function CampaignPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Checked before anything streams, so an unknown id is a real HTTP 404.
  // (That's why this route has no loading.tsx: the skeleton is the Suspense fallback below.)
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  // Drafts and scheduled campaigns open in the editor; anything queued shows its report.
  if (isEditable(campaign.status)) {
    return (
      <Suspense fallback={<CampaignSkeleton />}>
        <CampaignEditor campaign={campaign} notice={firstParam(query.notice)} />
      </Suspense>
    );
  }

  const requested = firstParam(query.filter);
  const filter: RecipientFilter = RECIPIENT_FILTERS.find((f) => f === requested) ?? "all";
  return (
    <Suspense fallback={<CampaignSkeleton />}>
      <CampaignReport campaign={campaign} filter={filter} page={parsePage(query.page)} />
    </Suspense>
  );
}
