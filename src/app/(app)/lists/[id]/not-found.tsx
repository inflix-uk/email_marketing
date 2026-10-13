import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";

export default function ListNotFound() {
  return (
    <EmptyState
      title="List not found"
      description="It may have been deleted, or the link is wrong."
      action={<ButtonLink href="/lists">Back to lists</ButtonLink>}
    />
  );
}
