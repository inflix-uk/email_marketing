import { CampaignSkeleton } from "../_components/skeleton";

// Lives in the (list) route group on purpose: a loading.tsx directly under
// /campaigns would also wrap /campaigns/[id] and start streaming (HTTP 200)
// before that page can answer 404 for an unknown campaign.
export default function CampaignsLoading() {
  return <CampaignSkeleton />;
}
