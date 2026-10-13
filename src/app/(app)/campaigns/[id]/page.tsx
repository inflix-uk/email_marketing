import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { firstParam, getCampaign, isEditable, parsePage, RECIPIENT_FILTERS, type RecipientFilter } from "../_lib/queries";
import { CampaignEditor } from "./campaign-editor";
import { CampaignReport } from "./campaign-report";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ filter?: string | string[]; page?: string | string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const campaign = await getCampaign((await params).id);
  return { title: campaign?.name ?? "Campaign not found" };
}

export default async function CampaignPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  // Drafts and scheduled campaigns open in the editor; anything queued shows its report.
  if (isEditable(campaign.status)) {
    return <CampaignEditor campaign={campaign} />;
  }

  const requested = firstParam(query.filter);
  const filter: RecipientFilter = RECIPIENT_FILTERS.find((f) => f === requested) ?? "all";
  return <CampaignReport campaign={campaign} filter={filter} page={parsePage(query.page)} />;
}
