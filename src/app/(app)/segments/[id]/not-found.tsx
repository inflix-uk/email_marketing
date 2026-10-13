import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";

export default function SegmentNotFound() {
  return (
    <EmptyState
      title="Segment not found"
      description="It may have been deleted, or the link is wrong."
      action={<ButtonLink href="/segments">Back to segments</ButtonLink>}
    />
  );
}
