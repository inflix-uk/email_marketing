import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";

export default function CampaignNotFound() {
  return (
    <EmptyState
      title="Campaign not found"
      description="It may have been deleted, or the link is wrong."
      action={<ButtonLink href="/campaigns">Back to campaigns</ButtonLink>}
    />
  );
}
